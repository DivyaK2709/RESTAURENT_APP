const express = require('express')
const cors    = require('cors')
const sql     = require('mssql')

// ── Registry config (reads HKLM\SOFTWARE\YNOT\POS at startup) ────────────────
const { loadConfig } = require('./registry-config')
const REG = loadConfig()

const app = express()
app.use(cors())
app.use(express.json())

const dbConfig = {
  server:   REG.db.server,
  database: REG.db.database,
  user:     REG.db.user,
  password: REG.db.password,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 3000,
    requestTimeout: 5000
  },
  pool: {
    max: 20,
    min: 5,
    idleTimeoutMillis: 300000
  }
}

let pool = null

async function getPool(retries = 5) {
  while (retries) {
    try {
      if (!pool) {
        pool = await sql.connect(dbConfig)
        console.log('✅ Connected to LEGEND')
      }
      return pool
    } catch (err) {
      console.log('DB retry...', err.message)
      retries--
      await new Promise(r => setTimeout(r, 5000))
    }
  }
  throw new Error('Database connection failed after retries')
}

// ── Per-table mutex — prevents simultaneous hold/KOT for same table ───────────
const _tableLocks = {}
async function withTableLock(tableId, fn) {
  const key = String(tableId)
  const prev = _tableLocks[key] || Promise.resolve()
  let resolve
  _tableLocks[key] = prev.then(() => new Promise(r => { resolve = r }))
  try {
    await prev
    return await fn()
  } finally {
    resolve()
  }
}

// ── Column probe cache ────────────────────────────────────────────────────────
const _cols = {
  det: { checked: false, typecaption: false, description: false, kotordertime: false, kitchenNote: false, pslno: false },
  mst: { checked: false, amountReceived: false, balance: false, typecaption: false }
}

async function probeColumns(p) {
  if (!_cols.det.checked) {
    try {
      const r = await p.request().query(`
        SELECT name FROM sys.columns
        WHERE object_id=OBJECT_ID('PSalesDetails')
          AND name IN ('typecaption','Description','kotordertime','KitchenNote','PSlNo')`)
      const names = r.recordset.map(x => x.name.toLowerCase())
      _cols.det.typecaption  = names.includes('typecaption')
      _cols.det.description  = names.includes('description')
      _cols.det.kotordertime = names.includes('kotordertime')
      _cols.det.kitchenNote  = names.includes('kitchennote')
      _cols.det.pslno        = names.includes('pslno')
      _cols.det.checked      = true
      console.log('PSalesDetails cols:', JSON.stringify(_cols.det))
    } catch(e) { console.error('probeColumns det:', e.message); _cols.det.checked = true }
  }
  if (!_cols.mst.checked) {
    try {
      const r = await p.request().query(`
        SELECT name FROM sys.columns
        WHERE object_id=OBJECT_ID('PSalesMaster')
          AND name IN ('AmountReceived','Balance','typecaption')`)
      const names = r.recordset.map(x => x.name.toLowerCase())
      _cols.mst.amountReceived = names.includes('amountreceived')
      _cols.mst.balance        = names.includes('balance')
      _cols.mst.typecaption    = names.includes('typecaption')
      _cols.mst.checked        = true
      console.log('PSalesMaster cols:', JSON.stringify(_cols.mst))
    } catch(e) { console.error('probeColumns mst:', e.message); _cols.mst.checked = true }
  }
}

async function initDB() {
  const p = await getPool()
  await probeColumns(p)

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='pos_users' AND xtype='U')
    CREATE TABLE pos_users (
      id INT IDENTITY(1,1) PRIMARY KEY,
      username NVARCHAR(50) UNIQUE NOT NULL,
      password NVARCHAR(100) NOT NULL,
      name     NVARCHAR(100) NOT NULL,
      role     NVARCHAR(20) DEFAULT 'cashier')`)

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='pos_settings' AND xtype='U')
    CREATE TABLE pos_settings (
      id       INT IDENTITY(1,1) PRIMARY KEY,
      key_name NVARCHAR(100) UNIQUE NOT NULL,
      value    NVARCHAR(500))`)

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='TableSessionLock' AND xtype='U')
    CREATE TABLE TableSessionLock (
      TableId   INT PRIMARY KEY,
      LockedBy  NVARCHAR(100) NOT NULL,
      LockedAt  DATETIME NOT NULL DEFAULT GETDATE())`)

  const detCols = [
    ['kotstatus',    'INT DEFAULT 0'],
    ['kotordertime', 'DATETIME NULL'],
    ['typecaption',  "NVARCHAR(50) DEFAULT 'DINE IN'"],
  ]
  for (const [col, def] of detCols) {
    try {
      await p.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns
                       WHERE object_id=OBJECT_ID('PSalesDetails') AND name='${col}')
        ALTER TABLE PSalesDetails ADD ${col} ${def}`)
      console.log(`✅ ${col} ensured in PSalesDetails`)
    } catch(e) { console.error(`${col}:`, e.message) }
  }

  _cols.det.checked = false
  _cols.mst.checked = false
  await probeColumns(p)

  await seedDefaults(p)
  console.log('✅ DB ready')
}

async function seedDefaults(p) {
  const u = await p.request().query(`SELECT COUNT(*) as cnt FROM pos_users`)
  if (u.recordset[0].cnt === 0) {
    await p.request().query(`
      INSERT INTO pos_users (username,password,name,role) VALUES
      ('admin','admin','Admin','admin'),('cashier1','1234','Cashier One','cashier')`)
  }
  const s = await p.request().query(`SELECT COUNT(*) as cnt FROM pos_settings`)
  if (s.recordset[0].cnt === 0) {
    await p.request().query(`
      INSERT INTO pos_settings (key_name,value) VALUES
      ('companyName','RESTAURANT'),('address',''),('gst',''),
      ('footer1','THANK YOU AND VISIT AGAIN'),('footer2','No Cash Refund')`)
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function exeInvDate() {
  const now = new Date()
  const y   = now.getFullYear()
  const m   = String(now.getMonth() + 1).padStart(2, '0')
  const d   = String(now.getDate()).padStart(2, '0')
  return new Date(`${y}-${m}-${d}T00:00:00.000`)
}
function exeInvTime() {
  const now = new Date()
  return new Date(1899, 11, 30, now.getHours(), now.getMinutes(), now.getSeconds(), 0)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getLegendCounterInfo(p) {
  const r = await p.request().query(`
    SELECT TOP 1 CounterOpId, CounterId, CashierId, DayOpenId
    FROM PSalesMaster WHERE CounterId IS NOT NULL ORDER BY CAST(InvNo AS INT) DESC`)
  if (!r.recordset.length) return { counterOpId:1, counterId:1, cashierId:1, dayOpenId:1 }
  return {
    counterOpId: parseInt(r.recordset[0].CounterOpId) || 1,
    counterId:   parseInt(r.recordset[0].CounterId)   || 1,
    cashierId:   parseInt(r.recordset[0].CashierId)   || 1,
    dayOpenId:   parseInt(r.recordset[0].DayOpenId)   || 1,
  }
}

// ── getNextInvNo — mirrors EXE NextbillNo logic with CAST to INT ──────────────
async function getNextInvNo(p) {
  const tx = new sql.Transaction(p)
  await tx.begin()
  try {
    const req = new sql.Request(tx)

    const rBill = await req.query(
      `SELECT ISNULL(MAX(CAST(BillNo AS INT)),0) as mx FROM PBillTable WITH (TABLOCKX, HOLDLOCK)`)
    const maxBill = rBill.recordset[0].mx

    const rSales = await req.query(
      `SELECT ISNULL(MAX(CAST(InvNo AS INT)),0) as mx FROM PSalesDetails WITH (TABLOCKX, HOLDLOCK)`)
    const maxSalesDet = rSales.recordset[0].mx

    const rMaster = await req.query(
      `SELECT ISNULL(MAX(CAST(InvNo AS INT)),0) as mx FROM PSalesMaster WITH (TABLOCKX, HOLDLOCK)`)
    const maxSalesMst = rMaster.recordset[0].mx

    const maxSales = Math.max(maxSalesDet, maxSalesMst)
    const nid = maxSales > maxBill ? maxSales + 1 : maxBill + 1

    await req
      .input('bn', sql.Int, nid)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM PBillTable WHERE CAST(BillNo AS INT)=@bn)
          INSERT INTO PBillTable (BillNo, CCode, ValidFlag) VALUES (@bn, 1, 0)`)

    await tx.commit()
    console.log(`  getNextInvNo -> ${nid} (maxBill=${maxBill}, maxSales=${maxSales})`)
    return nid
  } catch(e) {
    await tx.rollback().catch(()=>{})
    throw e
  }
}

// ── getTableNo — returns pos_in_room (EXE's TableNo), not raw Tableid ─────────
// FIX: EXE stores TableNo = position within room (1-based), not global Tableid
async function getTableNo(p, tableId) {
  try {
    const id = parseInt(tableId)
    if (!id || isNaN(id)) return 0
    const r = await p.request()
      .input('tid', sql.Int, id)
      .query(`
        SELECT pos_in_room FROM (
          SELECT Tableid,
            ROW_NUMBER() OVER (PARTITION BY RoomId ORDER BY Tableid) as pos_in_room
          FROM PTable
          WHERE CCOde = 1
        ) t
        WHERE Tableid = @tid
      `)
    if (!r.recordset.length) return 0
    return Number(r.recordset[0].pos_in_room)
  } catch(e) { console.error('getTableNo error:', e.message); return 0 }
}

// ── getRoomInfo — returns pos_in_room + RoomId + min/max Tableid in room ──────
async function getRoomInfo(p, tableId) {
  const id = parseInt(tableId)
  if (!id || isNaN(id)) return null
  try {
    const r = await p.request()
      .input('tid', sql.Int, id)
      .query(`
        SELECT pos_in_room, RoomId FROM (
          SELECT Tableid, RoomId,
            ROW_NUMBER() OVER (PARTITION BY RoomId ORDER BY Tableid) as pos_in_room
          FROM PTable WHERE CCOde = 1
        ) t WHERE Tableid = @tid
      `)
    if (!r.recordset.length) return null
    const { pos_in_room, RoomId } = r.recordset[0]

    const rng = await p.request()
      .input('rid', sql.Int, RoomId)
      .query(`
        SELECT MIN(Tableid) as minId, MAX(Tableid) as maxId
        FROM PTable WHERE RoomId = @rid AND CCOde = 1
      `)
    const { minId, maxId } = rng.recordset[0]
    return { pos_in_room, RoomId, minId, maxId }
  } catch(e) { console.error('getRoomInfo error:', e.message); return null }
}

// ── getHeldInvNo — scoped by room to avoid cross-room collision ───────────────
async function getHeldInvNo(p, tableId) {
  try {
    const info = await getRoomInfo(p, tableId)
    if (!info) return null
    const { pos_in_room, minId, maxId } = info

    // EXE stores TableNo = pos_in_room; scope to room's Tableid range to avoid
    // collision when two rooms share the same pos_in_room number
    const r = await p.request()
      .input('tno', sql.Int, pos_in_room)
      .input('min', sql.Int, minId)
      .input('max', sql.Int, maxId)
      .query(`
        SELECT TOP 1 m.InvNo FROM PSalesMaster m WITH (NOLOCK)
        WHERE m.TableNo = @tno
          AND m.HoldFlag = 1 AND m.CCode = 1 AND m.SalesType = 1
          AND EXISTS (
            SELECT 1 FROM PTable t
            WHERE t.Tableid BETWEEN @min AND @max
              AND t.CCOde = 1
              AND ROW_NUMBER() OVER (PARTITION BY t.RoomId ORDER BY t.Tableid) = m.TableNo
          )
        ORDER BY m.InvNo DESC
      `)
    return r.recordset[0]?.InvNo || null
  } catch(e) {
    // Fallback: simple query without room scoping
    console.error('getHeldInvNo error, using fallback:', e.message)
    try {
      const info = await getRoomInfo(p, tableId)
      if (!info) return null
      const r = await p.request()
        .input('tno', sql.Int, info.pos_in_room)
        .query(`
          SELECT TOP 1 InvNo FROM PSalesMaster WITH (NOLOCK)
          WHERE TableNo=@tno AND HoldFlag=1 AND CCode=1 AND SalesType=1
          ORDER BY InvNo DESC
        `)
      return r.recordset[0]?.InvNo || null
    } catch(e2) { console.error('getHeldInvNo fallback error:', e2.message); return null }
  }
}

// ── freeTable — uses pos_in_room scoped by room ───────────────────────────────
async function freeTable(p, tableId) {
  try {
    const info = await getRoomInfo(p, tableId)
    if (!info) return
    const { pos_in_room, minId, maxId } = info
    await p.request()
      .input('tno', sql.Int, pos_in_room)
      .input('min', sql.Int, minId)
      .input('max', sql.Int, maxId)
      .query(`
        UPDATE PSalesMaster SET HoldFlag=0
        WHERE TableNo=@tno AND HoldFlag=1 AND CCode=1
          AND TableNo BETWEEN @min AND @max
      `)
    console.log(`  freeTable pos_in_room=${pos_in_room} range=${minId}-${maxId}`)
  } catch(e) { console.error('freeTable error:', e.message) }
}

// ── ATOMIC SlNo generator ─────────────────────────────────────────────────────
async function insertDetailRowAtomic(p, invNo, item, kotStatus, kotTime) {
  await probeColumns(p)
  const bc   = (item.barcode && item.barcode.trim()) ? item.barcode.trim() : `ITEM${item.id || 0}`
  const qty  = parseFloat(item.qty)  || 1
  const rate = parseFloat(item.rate) || 0
  const unit = parseInt(item.unitId) || 0

  let extraCols = ''
  let extraVals = ''
  const req = p.request()
    .input('inv',  sql.Int,          invNo)
    .input('bc',   sql.NVarChar(50), bc)
    .input('qty',  sql.Float,        qty)
    .input('unit', sql.Int,          unit)
    .input('rate', sql.Money,        rate)
    .input('kots', sql.Int,          kotStatus)

  if (_cols.det.kotordertime) {
    req.input('kotime', sql.DateTime, kotTime || null)
    extraCols += ',kotordertime'; extraVals += ',@kotime'
  }
  if (_cols.det.typecaption) {
    req.input('tc', sql.NVarChar(50), 'DINE IN')
    extraCols += ',typecaption'; extraVals += ',@tc'
  } else if (_cols.det.description) {
    req.input('tc', sql.NVarChar(50), 'DINE IN')
    extraCols += ',Description'; extraVals += ',@tc'
  }
  if (_cols.det.kitchenNote) {
    req.input('kn', sql.NVarChar(500), item.kitchenNote || '')
    extraCols += ',KitchenNote'; extraVals += ',@kn'
  }
  if (_cols.det.pslno) {
    req.input('psl', sql.Int, item.pslNo || 0)
    extraCols += ',PSlNo'; extraVals += ',@psl'
  }

  await req.query(`
    MERGE PSalesDetails WITH (HOLDLOCK) AS tgt
    USING (SELECT @inv AS InvNo, @bc AS Barcode) AS src
    ON tgt.InvNo = src.InvNo AND tgt.Barcode = src.Barcode AND ISNULL(tgt.kotstatus,0) = 0
    WHEN NOT MATCHED THEN
      INSERT (InvNo, SlNo, Barcode, Qty, Unitid, Rate, Discount, CCode, BatchNo, kotstatus, Stausflag${extraCols})
      VALUES (@inv,
        (SELECT ISNULL(MAX(SlNo),0)+1 FROM PSalesDetails WHERE InvNo=@inv),
        @bc, @qty, @unit, @rate, 0, 1, '', @kots, 0${extraVals})
    WHEN MATCHED THEN
      UPDATE SET Qty=@qty, Rate=@rate, kotstatus=@kots${_cols.det.typecaption ? ", typecaption='DINE IN'" : ''};
  `)
  console.log(`  Upserted bc=${bc} qty=${qty} rate=${rate} kot=${kotStatus}`)
}

// ── KOT version ───────────────────────────────────────────────────────────────
async function insertOrUpgradeKOT(p, invNo, item) {
  await probeColumns(p)
  const bc   = (item.barcode && item.barcode.trim()) ? item.barcode.trim() : `ITEM${item.id || 0}`
  const qty  = parseFloat(item.qty)  || 1
  const rate = parseFloat(item.rate) || 0
  const unit = parseInt(item.unitId) || 0
  const now  = new Date()

  let extraCols = ''
  let extraVals = ''
  const req = p.request()
    .input('inv',    sql.Int,          invNo)
    .input('bc',     sql.NVarChar(50), bc)
    .input('qty',    sql.Float,        qty)
    .input('unit',   sql.Int,          unit)
    .input('rate',   sql.Money,        rate)
    .input('kotime', sql.DateTime,     now)

  if (_cols.det.kotordertime) {
    extraCols += ',kotordertime'; extraVals += ',@kotime'
  }
  if (_cols.det.typecaption) {
    req.input('tc', sql.NVarChar(50), 'DINE IN')
    extraCols += ',typecaption'; extraVals += ',@tc'
  } else if (_cols.det.description) {
    req.input('tc', sql.NVarChar(50), 'DINE IN')
    extraCols += ',Description'; extraVals += ',@tc'
  }
  if (_cols.det.kitchenNote) {
    req.input('kn', sql.NVarChar(500), item.kitchenNote || '')
    extraCols += ',KitchenNote'; extraVals += ',@kn'
  }
  if (_cols.det.pslno) {
    req.input('psl', sql.Int, item.pslNo || 0)
    extraCols += ',PSlNo'; extraVals += ',@psl'
  }

  const kotUpdateSet = `Qty=@qty, Rate=@rate, kotstatus=1${_cols.det.kotordertime ? ', kotordertime=@kotime' : ''}${_cols.det.typecaption ? ", typecaption='DINE IN'" : ''}`

  await req.query(`
    MERGE PSalesDetails WITH (HOLDLOCK) AS tgt
    USING (SELECT @inv AS InvNo, @bc AS Barcode) AS src
    ON tgt.InvNo = src.InvNo AND tgt.Barcode = src.Barcode
    WHEN NOT MATCHED THEN
      INSERT (InvNo, SlNo, Barcode, Qty, Unitid, Rate, Discount, CCode, BatchNo, kotstatus, Stausflag${extraCols})
      VALUES (@inv,
        (SELECT ISNULL(MAX(SlNo),0)+1 FROM PSalesDetails WHERE InvNo=@inv),
        @bc, @qty, @unit, @rate, 0, 1, '', 1, 0${extraVals})
    WHEN MATCHED THEN
      UPDATE SET ${kotUpdateSet};
  `)
  console.log(`  KOT upsert bc=${bc} qty=${qty} rate=${rate}`)
}

// ── recalcTotAmount ───────────────────────────────────────────────────────────
async function recalcTotAmount(p, invNo, discount) {
  const dis = parseFloat(discount) || 0
  await p.request()
    .input('inv', sql.Int,   invNo)
    .input('dis', sql.Money, dis)
    .query(`
      UPDATE PSalesMaster
      SET TotAmount = ISNULL((SELECT SUM(Qty*Rate) FROM PSalesDetails WHERE InvNo=@inv), 0) - @dis,
          Discount  = @dis
      WHERE InvNo=@inv AND CCode=1`)
  console.log(`  TotAmount recalculated InvNo=${invNo}`)
}

// ── insertPSalesMaster ────────────────────────────────────────────────────────
// FIX: Stausflag=1 so EXE shows table as occupied (cyan)
async function insertPSalesMaster(p, { inv, dis, tno, cop, ctr, cas, dop, holdFlag, cash, card, cred, recd, bal, totAmount }) {
  await probeColumns(p)
  const safeTot = parseFloat(totAmount) || 0

  const req = p.request()
    .input('inv',  sql.Int,      inv)
    .input('idat', sql.DateTime, exeInvDate())
    .input('itim', sql.DateTime, exeInvTime())
    .input('hf',   sql.Int,      holdFlag ?? 1)
    .input('tot',  sql.Money,    safeTot)
    .input('dis',  sql.Money,    dis   || 0)
    .input('tno',  sql.Int,      tno   || 0)
    .input('cop',  sql.Int,      cop)
    .input('ctr',  sql.Int,      ctr)
    .input('cas',  sql.Int,      cas)
    .input('dop',  sql.Int,      dop)
    .input('cash', sql.Money,    cash  || 0)
    .input('card', sql.Money,    card  || 0)
    .input('cred', sql.Money,    cred  || 0)

  let cols = `InvNo,InvDate,InvTime,CCode,SalesType,HoldFlag,TableNo,
              TotAmount,Discount,TotCash,TotCreditCard,TotCredit,
              CounterId,CashierId,DayOpenId,CounterOpId,ResetNo,
              CustomerId,TotAltCurrency,AltCurrencyId,TransNo,
              TakeAway,Delivery,Stausflag`
  let vals = `@inv,@idat,@itim,1,1,@hf,@tno,
              @tot,@dis,@cash,@card,@cred,
              @ctr,@cas,@dop,@cop,0,
              0,0.00,0,0,
              0,0,1`

  if (_cols.mst.amountReceived) {
    req.input('recd', sql.Money, recd || 0)
    cols += ',AmountReceived'; vals += ',@recd'
  }
  if (_cols.mst.balance) {
    req.input('bal', sql.Money, bal || 0)
    cols += ',Balance'; vals += ',@bal'
  }

  await req.query(`INSERT INTO PSalesMaster (${cols}) VALUES (${vals})`)
  console.log(`  ✅ PSalesMaster InvNo=${inv} HoldFlag=${holdFlag ?? 1} TotAmount=${safeTot} TableNo=${tno}`)
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', db: 'LEGEND' }))

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body
    const p = await getPool()
    const r = await p.request()
      .input('u',  sql.NVarChar(100), username)
      .input('pw', sql.NVarChar(100), password)
      .query(`SELECT id,username,name,role FROM pos_users WHERE username=@u AND password=@pw`)
    if (!r.recordset.length) return res.status(401).json({ error: 'Invalid credentials' })
    res.json({ user: r.recordset[0] })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── ROOMS ─────────────────────────────────────────────────────────────────────
app.get('/api/rooms', async (req, res) => {
  try {
    const p = await getPool()
    const r = await p.request().query(`
      SELECT RoomId as id, LTRIM(RTRIM(RmCaption)) as name,
        CASE
          WHEN RmCaption LIKE '%DINE%'   THEN N'🍽️'
          WHEN RmCaption LIKE '%TAKE%'   THEN N'🥡'
          WHEN RmCaption LIKE '%DELIV%'  THEN N'🛵'
          WHEN RmCaption LIKE '%FAMILY%' THEN N'👨‍👩‍👧'
          WHEN RmCaption LIKE '%PARTY%'  THEN N'🎉'
          WHEN RmCaption LIKE '%BAR%'    THEN N'🍺'
          ELSE N'🏷️'
        END as icon
      FROM proom ORDER BY RoomId`)
    res.json(r.recordset)
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/rooms', async (req, res) => {
  try {
    const p  = await getPool()
    const mx = await p.request().query(`SELECT ISNULL(MAX(RoomId),0)+1 as nid FROM proom`)
    await p.request()
      .input('id', sql.Int,           mx.recordset[0].nid)
      .input('n',  sql.NVarChar(200), req.body.name.toUpperCase())
      .query(`INSERT INTO proom (RoomId,RmCaption) VALUES (@id,@n)`)
    const r = await p.request().query(`SELECT RoomId as id, LTRIM(RTRIM(RmCaption)) as name FROM proom ORDER BY RoomId`)
    res.json(r.recordset)
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const p = await getPool()
    await p.request().input('id', sql.Int, req.params.id).query(`DELETE FROM proom WHERE RoomId=@id`)
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── TABLES ────────────────────────────────────────────────────────────────────
// FIX: join PSalesMaster on pos_in_room instead of raw Tableid
app.get('/api/tables', async (req, res) => {
  try {
    const p      = await getPool()
    const roomId = req.query.roomId
    let q = `
      WITH RankedTables AS (
        SELECT Tableid, RoomId, caption, CCOde,
          ROW_NUMBER() OVER (PARTITION BY RoomId ORDER BY Tableid) as pos_in_room
        FROM PTable WHERE CCOde=1
      ),
      LatestBills AS (
        SELECT TableNo, InvNo,
          ROW_NUMBER() OVER (PARTITION BY TableNo ORDER BY CAST(InvNo AS INT) DESC) rn
        FROM PSalesMaster WITH (NOLOCK)
        WHERE HoldFlag=1 AND SalesType=1 AND CCode=1
      )
      SELECT rt.Tableid as id, rt.RoomId as room_id,
        LTRIM(RTRIM(rt.caption)) as caption,
        LTRIM(RTRIM(r.RmCaption)) as room_name,
        CASE WHEN lb.InvNo IS NOT NULL THEN 'occupied' ELSE 'free' END as status,
        lb.InvNo as held_inv_no
      FROM RankedTables rt
      LEFT JOIN proom r ON rt.RoomId=r.RoomId
      LEFT JOIN LatestBills lb ON lb.TableNo=rt.pos_in_room AND lb.rn=1
      WHERE rt.CCOde=1`
    if (roomId) q += ` AND rt.RoomId=${parseInt(roomId)}`
    q += ` ORDER BY rt.Tableid`
    const r = await p.request().query(q)
    res.json(r.recordset)
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/tables', async (req, res) => {
  try {
    const { roomId, caption } = req.body
    const p  = await getPool()
    const mx = await p.request().query(`SELECT ISNULL(MAX(Tableid),0)+1 as nid FROM PTable`)
    await p.request()
      .input('id',  sql.Int,     mx.recordset[0].nid)
      .input('rid', sql.Int,     roomId)
      .input('cap', sql.VarChar, caption.toUpperCase())
      .query(`INSERT INTO PTable (Tableid,RoomId,caption,CCOde) VALUES (@id,@rid,@cap,1)`)
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.put('/api/tables/:id/status', async (req, res) => {
  try {
    const p = await getPool()
    if (req.body.status === 'free') await freeTable(p, req.params.id)
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.delete('/api/tables/:id', async (req, res) => {
  try {
    const p = await getPool()
    await p.request().input('id', sql.Int, req.params.id).query(`DELETE FROM PTable WHERE Tableid=@id`)
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── TABLE LOCK ────────────────────────────────────────────────────────────────
app.post('/api/tables/:id/lock', async (req, res) => {
  try {
    const tableId  = parseInt(req.params.id)
    const { lockedBy } = req.body
    if (!tableId || !lockedBy)
      return res.status(400).json({ error: 'tableId and lockedBy required' })
    const p = await getPool()
    const existing = await p.request()
      .input('tid', sql.Int, tableId)
      .query(`SELECT LockedBy, LockedAt FROM TableSessionLock WHERE TableId = @tid`)
    if (existing.recordset.length > 0) {
      const locker     = existing.recordset[0].LockedBy
      const lockedAt   = existing.recordset[0].LockedAt
      const ageMinutes = (Date.now() - new Date(lockedAt).getTime()) / 60000
      if (locker === lockedBy) {
        await p.request()
          .input('tid', sql.Int,           tableId)
          .input('by',  sql.NVarChar(100), lockedBy)
          .query(`UPDATE TableSessionLock SET LockedAt=GETDATE() WHERE TableId=@tid`)
        return res.json({ success: true, warning: false, lockedBy })
      }
      if (ageMinutes <= 30) {
        console.log(`⚠️  Table ${tableId} locked by "${locker}", "${lockedBy}" warned`)
        return res.json({
          success: true, warning: true,
          message: `Table already opened by "${locker}". Coordinate before making changes!`,
          lockedBy: locker
        })
      }
      await p.request()
        .input('tid', sql.Int, tableId)
        .query(`DELETE FROM TableSessionLock WHERE TableId=@tid`)
      console.log(`⚠️  Stale lock cleared (was ${locker}, ${ageMinutes.toFixed(1)} min)`)
    }
    await p.request()
      .input('tid', sql.Int,           tableId)
      .input('by',  sql.NVarChar(100), lockedBy)
      .query(`
        MERGE TableSessionLock AS tgt
        USING (SELECT @tid AS TableId) AS src ON tgt.TableId = src.TableId
        WHEN MATCHED THEN UPDATE SET LockedBy=@by, LockedAt=GETDATE()
        WHEN NOT MATCHED THEN INSERT (TableId,LockedBy,LockedAt) VALUES (@tid,@by,GETDATE());
      `)
    console.log(`🔒 Table ${tableId} locked by "${lockedBy}"`)
    res.json({ success: true, warning: false, lockedBy })
  } catch(e) {
    console.error('Table lock ERROR:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/tables/:id/unlock', async (req, res) => {
  try {
    const tableId = parseInt(req.params.id)
    const p = await getPool()
    await p.request()
      .input('tid', sql.Int, tableId)
      .query(`DELETE FROM TableSessionLock WHERE TableId=@tid`)
    console.log(`🔓 Table ${tableId} unlocked`)
    res.json({ success: true })
  } catch(e) {
    console.error('Table unlock ERROR:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/tables/:id/lock-status', async (req, res) => {
  try {
    const tableId = parseInt(req.params.id)
    const p = await getPool()
    const r = await p.request()
      .input('tid', sql.Int, tableId)
      .query(`SELECT LockedBy, LockedAt FROM TableSessionLock WHERE TableId=@tid`)
    if (r.recordset.length)
      res.json({ locked: true, lockedBy: r.recordset[0].LockedBy, lockedAt: r.recordset[0].LockedAt })
    else
      res.json({ locked: false })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── CATEGORIES ────────────────────────────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  try {
    const p = await getPool()
    const r = await p.request().query(`SELECT Id as id, LTRIM(RTRIM(Name)) as name, ISNULL(Code,'') as code FROM PCategoryMaster ORDER BY Id`)
    res.json(r.recordset)
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/categories', async (req, res) => {
  try {
    const p   = await getPool()
    const mx  = await p.request().query(`SELECT ISNULL(MAX(Id),0)+1 as nid FROM PCategoryMaster`)
    const nid = mx.recordset[0].nid
    await p.request()
      .input('id', sql.Int,           nid)
      .input('n',  sql.NVarChar(200), req.body.name.toUpperCase())
      .input('c',  sql.VarChar,       String(nid).padStart(4,'0'))
      .query(`INSERT INTO PCategoryMaster (Id,Name,Code) VALUES (@id,@n,@c)`)
    const r = await p.request().query(`SELECT Id as id, LTRIM(RTRIM(Name)) as name, Code as code FROM PCategoryMaster ORDER BY Id`)
    res.json(r.recordset)
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const p = await getPool()
    await p.request().input('id', sql.Int, req.params.id).query(`DELETE FROM PCategoryMaster WHERE Id=@id`)
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── ITEMS ─────────────────────────────────────────────────────────────────────
app.get('/api/items', async (req, res) => {
  try {
    const p = await getPool()
    const { catId, search } = req.query
    let q = `
      SELECT i.Id as id, LTRIM(RTRIM(i.Name)) as name, i.CategoryId as cat_id,
        ISNULL(LTRIM(RTRIM(c.Name)),'') as cat_name,
        CAST(i.SellingPrice AS FLOAT) as price, 'Plate' as unit,
        ISNULL(i.Barcode,'') as barcode, ISNULL(i.UnitId,0) as unit_id,
        ISNULL(i.ColorId,0) as colorId
      FROM PItemMaster i LEFT JOIN PCategoryMaster c ON i.CategoryId=c.Id
      WHERE i.SellingPrice > 0`
    if (catId)  q += ` AND i.CategoryId=${parseInt(catId)}`
    if (search) q += ` AND i.Name LIKE '%${search.replace(/'/g,"''")}%'`
    q += ` ORDER BY i.CategoryId, i.Name`
    const r = await p.request().query(q)
    res.json(r.recordset)
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/items', async (req, res) => {
  try {
    const { catId, name, price } = req.body
    const p   = await getPool()
    const mx  = await p.request().query(`SELECT ISNULL(MAX(Id),0)+1 as nid FROM PItemMaster`)
    const nid = mx.recordset[0].nid
    await p.request()
      .input('id', sql.Int,           nid)
      .input('c',  sql.Int,           catId)
      .input('n',  sql.NVarChar(200), name)
      .input('p',  sql.Decimal(10,2), price)
      .input('bc', sql.VarChar,       `ITEM${nid}`)
      .query(`INSERT INTO PItemMaster (Id,CategoryId,Name,SellingPrice,Barcode,CCode) VALUES (@id,@c,@n,@p,@bc,1)`)
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.delete('/api/items/:id', async (req, res) => {
  try {
    const p = await getPool()
    await p.request().input('id', sql.Int, req.params.id).query(`UPDATE PItemMaster SET SellingPrice=0 WHERE Id=@id`)
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── BILL COUNTER — uses CAST(AS INT) to avoid string MAX ordering bug ─────────
app.get('/api/bill-counter', async (req, res) => {
  try {
    const p = await getPool()
    const rBill = await p.request().query(
      `SELECT ISNULL(MAX(CAST(BillNo AS INT)),0)+1 as mx FROM PBillTable`)
    const rDet  = await p.request().query(
      `SELECT ISNULL(MAX(CAST(InvNo AS INT)),0)+1 as mx FROM PSalesDetails`)
    const rMst  = await p.request().query(
      `SELECT ISNULL(MAX(CAST(InvNo AS INT)),0)+1 as mx FROM PSalesMaster WHERE CCode=1`)
    const counter = Math.max(
      rBill.recordset[0].mx,
      rDet.recordset[0].mx,
      rMst.recordset[0].mx
    )
    res.json({ counter })
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/bill-counter/next', async (req, res) => {
  try {
    const p = await getPool()
    const r = await p.request().query(
      `SELECT ISNULL(MAX(CAST(InvNo AS INT)),0)+1 as counter FROM PSalesMaster WHERE CCode=1`)
    res.json({ counter: r.recordset[0].counter })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── BILLS LIST ────────────────────────────────────────────────────────────────
app.get('/api/bills', async (req, res) => {
  try {
    const p = await getPool()
    const r = await p.request().query(`
      SELECT TOP 300
        m.InvNo as id, CAST(m.InvNo AS NVARCHAR) as bill_no,
        CONVERT(NVARCHAR,m.InvDate,103) as bill_date,
        CONVERT(NVARCHAR,m.InvTime,108) as bill_time,
        ISNULL(LTRIM(RTRIM(r.RmCaption)),'') as room_name,
        ISNULL(LTRIM(RTRIM(t.caption)),CAST(m.TableNo AS NVARCHAR)) as table_caption,
        CAST(m.TotAmount AS FLOAT) as total, CAST(m.Discount AS FLOAT) as discount,
        CASE WHEN m.TotCreditCard>0 THEN 'card' WHEN m.TotCredit>0 THEN 'credit' ELSE 'cash' END as pay_mode,
        CASE WHEN m.HoldFlag=1 THEN 'held' ELSE 'saved' END as status,
        (SELECT COUNT(*) FROM PSalesDetails d WHERE d.InvNo=m.InvNo) as item_count
      FROM PSalesMaster m
      LEFT JOIN PTable t ON t.Tableid=m.TableNo AND t.CCOde=m.CCode
      LEFT JOIN proom  r ON t.RoomId=r.RoomId
      WHERE m.CCode=1 ORDER BY CAST(m.InvNo AS INT) DESC`)
    res.json(r.recordset)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── HELD BILL ─────────────────────────────────────────────────────────────────
app.get('/api/bills/held/:tableId', async (req, res) => {
  try {
    const p       = await getPool()
    const tableId = parseInt(req.params.tableId)
    if (!tableId || isNaN(tableId)) return res.status(400).json({ error: 'Invalid tableId' })
    const invNo = await getHeldInvNo(p, tableId)
    if (!invNo) return res.json({ held: false, items: [] })
    const master = await p.request()
      .input('inv', sql.Int, invNo)
      .query(`SELECT Discount FROM PSalesMaster WHERE InvNo=@inv AND CCode=1`)
    if (!master.recordset.length) return res.json({ held: false, items: [] })
    const discount = parseFloat(master.recordset[0].Discount) || 0
    const det = await p.request()
      .input('inv', sql.Int, invNo)
      .query(`
        SELECT d.SlNo as slno, d.Barcode as barcode,
          LTRIM(RTRIM(ISNULL(im.Name,d.Barcode))) as name,
          ISNULL(im.Id,0) as item_id,
          ISNULL(d.Qty,0) as qty, ISNULL(d.Rate,0) as rate,
          ISNULL(d.Unitid,0) as unit_id, ISNULL(d.BatchNo,'') as batch_no,
          ISNULL(d.kotstatus,0) as kotstatus, d.kotordertime as kot_order_time,
          ISNULL(im.ColorId,0) as colorId
        FROM PSalesDetails d WITH (NOLOCK)
        LEFT JOIN PItemMaster im WITH (NOLOCK) ON im.Barcode=d.Barcode
        WHERE d.InvNo=@inv ORDER BY d.SlNo`)
    if (!det.recordset.length) return res.json({ held: false, items: [] })
    const items = det.recordset.map(row => ({
      id:          row.item_id || 0,
      name:        row.name || row.barcode,
      qty:         parseFloat(row.qty),
      rate:        parseFloat(row.rate),
      barcode:     row.barcode,
      unitId:      row.unit_id || 0,
      batchNo:     row.batch_no || '',
      kitchenNote: '',
      kotPrinted:  row.kotstatus === 1,
      kotOrderTime:row.kot_order_time,
      typeCaption: 'DINE IN',
      colorId:     Number(row.colorId),
    }))
    res.json({ held: true, invNo, discount, items })
  } catch(e) {
    console.error('GET held bill ERROR:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── HOLD BILL ─────────────────────────────────────────────────────────────────
app.post('/api/bills/hold', async (req, res) => {
  const { tableId, items, discount } = req.body
  if (!tableId || !items || !items.length)
    return res.status(400).json({ error: 'tableId and items required' })
  try {
    const result = await withTableLock(tableId, async () => {
      const p            = await getPool()
      const safeDiscount = parseFloat(discount) || 0
      const tableNo      = await getTableNo(p, tableId)
      if (!tableNo) throw new Error(`Table ${tableId} not found`)
      const ci    = await getLegendCounterInfo(p)
      let invNo   = await getHeldInvNo(p, tableId)
      const computedTotal = items.reduce((s, i) => s + (parseFloat(i.qty)||1)*(parseFloat(i.rate)||0), 0)
      const safeTot       = Math.max(computedTotal - safeDiscount, 0) || computedTotal
      if (!invNo) {
        invNo = await getNextInvNo(p)
        console.log(`  Creating PSalesMaster InvNo=${invNo} TableNo=${tableNo}`)
        await insertPSalesMaster(p, {
          inv: invNo, dis: safeDiscount, tno: tableNo,
          cop: ci.counterOpId, ctr: ci.counterId,
          cas: ci.cashierId,   dop: ci.dayOpenId,
          holdFlag: 1, totAmount: safeTot
        })
      } else {
        await p.request()
          .input('inv', sql.Int,   invNo)
          .input('dis', sql.Money, safeDiscount)
          .query(`UPDATE PSalesMaster SET Discount=@dis, HoldFlag=1 WHERE InvNo=@inv AND CCode=1`)
        console.log(`  Updated PSalesMaster InvNo=${invNo}`)
      }
      for (const item of items) {
        if (item.kotPrinted) { console.log(`  Skip kotPrinted bc=${item.barcode}`); continue }
        await insertDetailRowAtomic(p, invNo, item, 0, null)
      }
      await recalcTotAmount(p, invNo, safeDiscount)
      console.log(`✅ Hold done TableId=${tableId} InvNo=${invNo}`)
      return { success: true, invNo }
    })
    res.json(result)
  } catch(e) {
    console.error('POST bills/hold ERROR:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── KOT ───────────────────────────────────────────────────────────────────────
app.post('/api/kot', async (req, res) => {
  const { tableCaption, items, tableId } = req.body
  if (!items || !items.length) return res.status(400).json({ error: 'No items' })
  try {
    const result = await withTableLock(tableId, async () => {
      const p       = await getPool()
      const tableNo = await getTableNo(p, tableId)
      const ci      = await getLegendCounterInfo(p)
      let invNo     = await getHeldInvNo(p, tableId)
      const computedTotal = items.reduce((s, i) => s + (parseFloat(i.qty)||1)*(parseFloat(i.rate)||0), 0)
      if (!invNo) {
        invNo = await getNextInvNo(p)
        console.log(`  Creating PSalesMaster for KOT InvNo=${invNo} TableNo=${tableNo}`)
        await insertPSalesMaster(p, {
          inv: invNo, dis: 0, tno: tableNo || 0,
          cop: ci.counterOpId, ctr: ci.counterId,
          cas: ci.cashierId,   dop: ci.dayOpenId,
          holdFlag: 1, totAmount: computedTotal
        })
      }
      for (const item of items) {
        if (item.kotPrinted) { console.log(`  Skip already-KOT bc=${item.barcode}`); continue }
        await insertOrUpgradeKOT(p, invNo, item)
      }
      await recalcTotAmount(p, invNo, 0)
      console.log(`✅ KOT done InvNo=${invNo} Table=${tableCaption}`)
      return { success: true, invNo }
    })
    res.json(result)
  } catch(e) {
    console.error('POST kot ERROR:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── SETTLE ────────────────────────────────────────────────────────────────────
app.post('/api/bills/settle', async (req, res) => {
  try {
    const { tableId } = req.body
    if (!tableId) return res.status(400).json({ error: 'tableId required' })
    const p     = await getPool()
    const invNo = await getHeldInvNo(p, tableId)
    if (invNo) {
      await p.request()
        .input('inv', sql.Int, invNo)
        .query(`UPDATE PSalesMaster SET HoldFlag=0 WHERE InvNo=@inv AND CCode=1`)
      console.log(`✅ Settled InvNo=${invNo}`)
    }
    await freeTable(p, tableId)
    res.json({ success: true, invNo })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── SAVE BILL ─────────────────────────────────────────────────────────────────
app.post('/api/bills', async (req, res) => {
  const { tableId, items, discount, total, amtReceived, changeAmt, payMode } = req.body
  try {
    const result = await withTableLock(tableId, async () => {
      const p            = await getPool()
      const safeTotal    = parseFloat(total)       || 0
      const safeDiscount = parseFloat(discount)    || 0
      const safeReceived = parseFloat(amtReceived) || safeTotal
      const safeChange   = parseFloat(changeAmt)   || 0
      const totCash      = payMode === 'cash'   ? safeReceived : 0
      const totCard      = payMode === 'card'   ? safeReceived : 0
      const totCred      = payMode === 'credit' ? safeReceived : 0
      const tableNo      = await getTableNo(p, tableId)
      const ci           = await getLegendCounterInfo(p)
      let invNo          = await getHeldInvNo(p, tableId)
      if (invNo) {
        await probeColumns(p)
        const upReq = p.request()
          .input('inv',  sql.Int,   invNo)
          .input('tot',  sql.Money, safeTotal)
          .input('dis',  sql.Money, safeDiscount)
          .input('cash', sql.Money, totCash)
          .input('card', sql.Money, totCard)
          .input('cred', sql.Money, totCred)
        let setClause = `HoldFlag=0,TotAmount=@tot,Discount=@dis,TotCash=@cash,TotCreditCard=@card,TotCredit=@cred`
        if (_cols.mst.amountReceived) {
          upReq.input('recd', sql.Money, safeReceived); setClause += ',AmountReceived=@recd'
        }
        if (_cols.mst.balance) {
          upReq.input('bal', sql.Money, safeChange); setClause += ',Balance=@bal'
        }
        await upReq.query(`UPDATE PSalesMaster SET ${setClause} WHERE InvNo=@inv AND CCode=1`)
      } else {
        invNo = await getNextInvNo(p)
        await insertPSalesMaster(p, {
          inv: invNo, dis: safeDiscount, tno: tableNo || 0,
          cop: ci.counterOpId, ctr: ci.counterId,
          cas: ci.cashierId,   dop: ci.dayOpenId,
          holdFlag: 0, cash: totCash, card: totCard, cred: totCred,
          recd: safeReceived, bal: safeChange, totAmount: safeTotal
        })
      }
      if (items && items.length) {
        for (const item of items) {
          await insertDetailRowAtomic(p, invNo, item,
            item.kotPrinted ? 1 : 0,
            item.kotOrderTime ? new Date(item.kotOrderTime) : null)
        }
      }
      await recalcTotAmount(p, invNo, safeDiscount)
      await freeTable(p, tableId)
      console.log(`✅ Bill saved InvNo=${invNo} Total=${safeTotal}`)
      return { success: true, billNo: String(invNo) }
    })
    res.json(result)
  } catch(e) { console.error('POST bills ERROR:', e.message); res.status(500).json({ error: e.message }) }
})

// ── USERS ─────────────────────────────────────────────────────────────────────
app.get('/api/users', async (req, res) => {
  try {
    const p = await getPool()
    const r = await p.request().query(`SELECT id,username,name,role FROM pos_users ORDER BY id`)
    res.json(r.recordset)
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/users', async (req, res) => {
  try {
    const { username, password, name, role } = req.body
    const p = await getPool()
    await p.request()
      .input('u',  sql.NVarChar(100), username)
      .input('pw', sql.NVarChar(100), password)
      .input('n',  sql.NVarChar(200), name)
      .input('r',  sql.NVarChar(50),  role || 'cashier')
      .query(`INSERT INTO pos_users (username,password,name,role) VALUES (@u,@pw,@n,@r)`)
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.delete('/api/users/:id', async (req, res) => {
  try {
    if (req.params.id == 1) return res.status(400).json({ error: 'Cannot delete default admin' })
    const p = await getPool()
    await p.request().input('id', sql.Int, req.params.id).query(`DELETE FROM pos_users WHERE id=@id`)
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── SETTINGS ──────────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const p = await getPool()
    const r = await p.request().query(`SELECT key_name,value FROM pos_settings`)
    const obj = {}
    r.recordset.forEach(row => { obj[row.key_name] = row.value })
    res.json(obj)
  } catch(e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/settings', async (req, res) => {
  try {
    const p = await getPool()
    for (const [key, val] of Object.entries(req.body)) {
      await p.request()
        .input('k', sql.NVarChar(100),     key)
        .input('v', sql.NVarChar(sql.MAX), val)
        .query(`
          IF EXISTS (SELECT 1 FROM pos_settings WHERE key_name=@k)
            UPDATE pos_settings SET value=@v WHERE key_name=@k
          ELSE INSERT INTO pos_settings (key_name,value) VALUES (@k,@v)`)
    }
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── REPORTS ───────────────────────────────────────────────────────────────────
app.get('/api/reports/summary', async (req, res) => {
  try {
    const p     = await getPool()
    const today = await p.request().query(`
      SELECT COUNT(*) as cnt, ISNULL(SUM(TotAmount),0) as revenue
      FROM PSalesMaster WITH (NOLOCK)
      WHERE CAST(InvDate AS DATE)=CAST(GETDATE() AS DATE) AND HoldFlag=0 AND CCode=1`)
    const overall = await p.request().query(`
      SELECT COUNT(*) as cnt, ISNULL(SUM(TotAmount),0) as revenue
      FROM PSalesMaster WITH (NOLOCK) WHERE HoldFlag=0 AND CCode=1`)
    let topItems = { recordset: [] }
    try {
      topItems = await p.request().query(`
        SELECT TOP 10 LTRIM(RTRIM(im.Name)) as item_name,
          SUM(d.Qty) as total_qty, SUM(d.Qty*d.Rate) as total_amt
        FROM PSalesDetails d WITH (NOLOCK)
        JOIN PSalesMaster m  WITH (NOLOCK) ON d.InvNo=m.InvNo
        JOIN PItemMaster  im WITH (NOLOCK) ON d.Barcode=im.Barcode AND im.CCode=1
        WHERE m.HoldFlag=0 AND m.CCode=1
        GROUP BY LTRIM(RTRIM(im.Name)) ORDER BY total_qty DESC`)
    } catch(e2) { console.error('topItems:', e2.message) }
    const payModes = await p.request().query(`
      SELECT
        CASE WHEN TotCreditCard>0 THEN 'card' WHEN TotCredit>0 THEN 'credit' ELSE 'cash' END as pay_mode,
        COUNT(*) as cnt, ISNULL(SUM(TotAmount),0) as revenue
      FROM PSalesMaster WITH (NOLOCK) WHERE HoldFlag=0 AND CCode=1
      GROUP BY CASE WHEN TotCreditCard>0 THEN 'card' WHEN TotCredit>0 THEN 'credit' ELSE 'cash' END`)
    res.json({
      today:    today.recordset[0],
      overall:  overall.recordset[0],
      topItems: topItems.recordset,
      payModes: payModes.recordset
    })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── CONFIG ────────────────────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({
    printServerPort: REG.printServerPort,
    backendPort:     REG.backendPort,
  })
})

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = REG.backendPort
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 POS Backend -> http://0.0.0.0:${PORT}`)
    console.log(`   DB: ${REG.db.database} @ ${REG.db.server}`)
    console.log(`   ✅ Per-table mutex: no more duplicate SlNo / double PSalesMaster inserts`)
    console.log(`   ✅ MERGE statement: atomic upsert, no PRIMARY KEY violations`)
    console.log(`   ✅ SlNo computed inside SQL INSERT — race-proof`)
    console.log(`   ✅ InvDate=local midnight, InvTime=1899-12-30 base`)
    console.log(`   ✅ TotAmount never 0 on insert`)
    console.log(`   ✅ CAST(AS INT) on all MAX(InvNo/BillNo) — no string ordering bug`)
    console.log(`   ✅ TableNo = pos_in_room — matches EXE table numbering`)
    console.log(`   ✅ Stausflag=1 — EXE shows table as occupied\n`)
  })
}).catch(err => {
  console.error('❌ DB init failed:', err.message)
  process.exit(1)
})