/**
 * THERMAL PRINT BRIDGE  v5.3  MULTI PRINTER
 * ==========================================
 * All config from Windows Registry via registry-config.js
 *
 * PRINTER1  — Network  colorId 1  → Food KOT
 * PRINTER2  — USB      colorId 2  → Drinks KOT
 * PRINTER3  — USB      bill only  → Bill Printer
 * PRINTER4  — Network  colorId 3  → Kitchen 2
 * PRINTER5  — Network  colorId 4  → Kitchen 3
 * PRINTER6–10 — Network (enabled when colorIds set in registry)
 */

'use strict'

const express        = require('express')
const cors           = require('cors')
const net            = require('net')
const os             = require('os')
const fs             = require('fs')
const { exec }       = require('child_process')
const path           = require('path')
const { loadConfig } = require('./registry-config')

// ── Load config — if this crashes, registry-config.js has a bug ──────────────
const CFG = loadConfig()
const app = express()

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Accept'], credentials: false }))
app.options('*', cors())
app.use(express.json({ limit: '2mb' }))

// ══════════════════════════════════════════════════════════════
//  CONFIG CONSTANTS (from registry)
// ══════════════════════════════════════════════════════════════
const SERVER_PORT       = CFG.printServerPort
const PRINTER_1_IP      = CFG.printer1.ip
const PRINTER_1_PORT    = CFG.printer1.port
const PRINTER_2_PORT    = CFG.printer2.port    // USB002
const PRINTER_2_NAME    = CFG.printer2.name    // POS-80
const BILL_PRINTER_NAME = CFG.printer3.name    // POS-80C
const BILL_PRINTER_PORT = CFG.printer3.port    // USB018
const W = 42

// ══════════════════════════════════════════════════════════════
//  ESC/POS COMMANDS
// ══════════════════════════════════════════════════════════════
const ESC = 0x1B
const GS  = 0x1D

const CMD = {
  INIT:         Buffer.from([ESC, 0x40]),
  CODEPAGE_437: Buffer.from([ESC, 0x74, 0x00]),
  ALIGN_LEFT:   Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT:  Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON:      Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:     Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_ON:    Buffer.from([ESC, 0x21, 0x30]),
  DOUBLE_OFF:   Buffer.from([ESC, 0x21, 0x00]),
  FEED_2:       Buffer.from([ESC, 0x64, 0x02]),
  FEED_3:       Buffer.from([ESC, 0x64, 0x03]),
  FEED_5:       Buffer.from([ESC, 0x64, 0x05]),
  PARTIAL_CUT:  Buffer.from([GS,  0x56, 0x42, 0x00]),
  LF:           Buffer.from([0x0A]),
}

const LINE  = '-'.repeat(W) + '\n'
const DLINE = '='.repeat(W) + '\n'

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function txt(str) {
  return Buffer.from(String(str || '').replace(/[^\x20-\x7E\x0A]/g, '?'), 'ascii')
}
const lj  = (s, w) => String(s || '').substring(0, w).padEnd(w, ' ')
const rj  = (s, w) => String(s || '').substring(0, w).padStart(w, ' ')
const ctr = (s, w) => {
  w = w || W
  const t   = String(s || '').substring(0, w)
  const pad = Math.max(0, Math.floor((w - t.length) / 2))
  return ' '.repeat(pad) + t
}
const fmt = v => Number(v || 0).toFixed(2)

function getLocalIPs() {
  const ifaces = os.networkInterfaces()
  const ips = []
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push({ name, address: iface.address })
    }
  }
  return ips
}

// ══════════════════════════════════════════════════════════════
//  NETWORK PRINTER
// ══════════════════════════════════════════════════════════════
function sendToNetworkPrinter(data, ip, port) {
  ip   = ip   || PRINTER_1_IP
  port = port || PRINTER_1_PORT

  return new Promise((resolve, reject) => {
    const client = new net.Socket()
    let done = false

    const finish = (err) => {
      if (done) return
      done = true
      client.destroy()
      err ? reject(err) : resolve()
    }

    client.setTimeout(8000)
    client.connect(port, ip, () => {
      console.log(`[NET] Connected → ${ip}:${port}`)
      const flushed = client.write(data)
      if (flushed) {
        setTimeout(() => finish(null), 1500)
      } else {
        client.once('drain', () => setTimeout(() => finish(null), 800))
      }
    })
    client.on('timeout', () => {
      finish(new Error(`Network printer timeout at ${ip}:${port}`))
    })
    client.on('error', (err) => {
      finish(new Error(`Cannot reach printer at ${ip}:${port} — ${err.message}`))
    })
  })
}

function testNetworkPrinter(ip, port) {
  const targetIP   = ip   || PRINTER_1_IP
  const targetPort = port || PRINTER_1_PORT
  return new Promise((resolve) => {
    const client = new net.Socket()
    let done = false
    const finish = (ok, msg) => {
      if (done) return; done = true
      client.destroy()
      resolve({ ok, msg })
    }
    client.setTimeout(4000)
    client.connect(targetPort, targetIP,
      () => finish(true,  `Reachable at ${targetIP}:${targetPort}`))
    client.on('timeout', () => finish(false, `Timeout: ${targetIP}:${targetPort}`))
    client.on('error',   e  => finish(false, `Error: ${e.message}`))
  })
}

// ══════════════════════════════════════════════════════════════
//  USB PRINTER — shared printer name method (most reliable)
// ══════════════════════════════════════════════════════════════
function sendRawToPrinter(data, printerName, tempFileName) {
  const safeLabel = String(printerName).replace(/[^a-zA-Z0-9_-]/g, '_')
  // NOTE: __dirname points inside pkg's virtual read-only snapshot when running
  // as a compiled .exe, so writing here fails with "was not included into
  // executable at compilation stage". os.tmpdir() is always a real folder on
  // disk (e.g. C:\Users\<user>\AppData\Local\Temp), so use that instead.
  const tempFile  = path.join(os.tmpdir(), tempFileName || `print_${safeLabel}.bin`)

  return new Promise((resolve, reject) => {
    try {
      fs.writeFileSync(tempFile, data)

      const computerName = os.hostname()
      const cmd = `copy /b "${tempFile}" "\\\\${computerName}\\${printerName}" /y`

      console.log(`[USB] Printing → "${printerName}"`)
      console.log(`[USB] CMD: ${cmd}`)

      exec(cmd, { shell: 'cmd.exe', timeout: 15000 }, (error, stdout, stderr) => {
        try { fs.unlinkSync(tempFile) } catch {}

        const out = (stdout || '').trim()
        const err = (stderr || '').trim()

        // "copy" prints "1 file(s) copied" on success
        if (!error || out.toLowerCase().includes('copied')) {
          console.log(`[USB] ✅ OK → "${printerName}"`)
          return resolve()
        }

        console.error(`[USB] ❌ FAILED → "${printerName}"`)
        console.error(`[USB] stdout: ${out}`)
        console.error(`[USB] stderr: ${err}`)
        reject(new Error(
          `USB print failed for "${printerName}"\n` +
          `Make sure the printer is SHARED in Windows:\n` +
          `  Control Panel → Devices & Printers → right-click ${printerName}\n` +
          `  → Printer Properties → Sharing → Share this printer\n` +
          `  Share name must match registry exactly: "${printerName}"\n` +
          `Error: ${err || error.message}`
        ))
      })
    } catch (e) {
      try { fs.unlinkSync(tempFile) } catch {}
      reject(e)
    }
  })
}

// KOT USB printer — PRINTER2
function sendToUSBPrinter(data, usbName) {
  const name = usbName || PRINTER_2_NAME
  // Unique filename per job — prevents overlapping/back-to-back print jobs
  // from overwriting the same temp file mid-copy (was causing intermittent
  // "works once, fails next time" behavior).
  const uniqueName = `kot_usb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bin`
  return sendRawToPrinter(data, name, uniqueName)
}

// Bill USB printer — PRINTER3
function sendToBillPrinter(data) {
  const uniqueName = `bill_usb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bin`
  return sendRawToPrinter(data, BILL_PRINTER_NAME, uniqueName)
}

// ── Share existence check — uses "net view" instead of "dir" ─────────────────
// NOTE: "dir \\host\printershare" ALWAYS fails with "The system cannot find
// the file specified", even when the share is working perfectly, because
// printer shares have no file listing to show. That false failure is what
// was causing PRINTER2/PRINTER3 to incorrectly report "share NOT found"
// while actual printing (copy /b ... ) worked the whole time.
// "net view \\host" lists shares (including printer shares) without touching
// paper, so it gives an accurate answer.
function checkShareExists(shareName) {
  return new Promise((resolve) => {
    const computerName = os.hostname()
    const cmd = `net view \\\\${computerName}`
    exec(cmd, { shell: 'cmd.exe', timeout: 8000 }, (error, stdout) => {
      if (error) return resolve(false)
      const pattern = new RegExp(`^${shareName}\\s`, 'im')
      resolve(pattern.test(stdout || ''))
    })
  })
}

async function validateBillPrinter() {
  return checkShareExists(BILL_PRINTER_NAME)
}

function testUSBPrinter() {
  return new Promise((resolve) => {
    checkShareExists(PRINTER_2_NAME).then(found => {
      if (!found) {
        resolve({ ok: false, msg: `"${PRINTER_2_NAME}" share NOT found. Share the printer in Windows first.` })
      } else {
        resolve({ ok: true,  msg: `"${PRINTER_2_NAME}" share found — ready` })
      }
    })
  })
}

// ══════════════════════════════════════════════════════════════
//  BUILD KOT BUFFER
// ══════════════════════════════════════════════════════════════
function buildKOTBuffer({ billNo, tableCaption, cashierName, items, printerLabel }) {
  const b = []
  b.push(CMD.INIT, CMD.CODEPAGE_437)

  b.push(CMD.ALIGN_LEFT, CMD.BOLD_ON)
  b.push(txt(lj('Bill# : ' + (billNo || ''), 21) + rj('Table: ' + (tableCaption || ''), 21) + '\n'))
  b.push(CMD.BOLD_OFF)

  if (cashierName) b.push(txt('Waiter: ' + cashierName + '\n'))
  b.push(txt(LINE))

  b.push(CMD.BOLD_ON)
  b.push(txt(lj('ITEM', 30) + rj('QTY', 12) + '\n'))
  b.push(CMD.BOLD_OFF)
  b.push(txt(LINE))

  ;(items || []).forEach(item => {
    const name = String(item.name || '')
    const qty  = String(item.qty  || 0)
    b.push(CMD.BOLD_ON)
    if (name.length <= 30) {
      b.push(txt(lj(name, 30) + rj(qty, 12) + '\n'))
    } else {
      b.push(txt(name.substring(0, W) + '\n'))
      b.push(txt(lj('', 30) + rj(qty, 12) + '\n'))
    }
    b.push(CMD.BOLD_OFF)
  })

  b.push(txt(LINE))

  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-IN')
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true })
  b.push(txt(lj(dateStr, 21) + rj(timeStr, 21) + '\n'))
  b.push(CMD.FEED_2, CMD.PARTIAL_CUT)
  return Buffer.concat(b)
}

// ══════════════════════════════════════════════════════════════
//  SPLIT KOT — routes items to correct printers by colorId
// ══════════════════════════════════════════════════════════════
async function printSplitKOT({ billNo, tableCaption, roomName, cashierName, items }) {

  console.log('\n[KOT] ══ PRINT REQUEST ══════════════════════════════')
  console.log('[KOT] Bill#:', billNo, '  Table:', tableCaption)
  console.log('[KOT] Items received:')
  items.forEach(i => console.log(`       → "${i.name}"  colorId=${i.colorId}  qty=${i.qty}`))
  console.log('[KOT] Active printers:')
  CFG.printers.forEach(p => console.log(`       ${p.name} (${p.type}) colorIds:[${p.colorIds}]`))
  console.log('[KOT] ═══════════════════════════════════════════════\n')

  const results = {}
  const jobs    = []

  for (const printer of CFG.printers) {

    // Match items to this printer by colorId
    let printerItems = items.filter(item =>
      printer.colorIds.includes(Number(item.colorId))
    )

    // PRINTER1 also catches items with no colorId (safe default)
    if (printer.name === 'PRINTER1') {
      const noColor = items.filter(i =>
        i.colorId == null || i.colorId === '' || isNaN(Number(i.colorId))
      )
      noColor.forEach(item => {
        if (!printerItems.includes(item)) printerItems.push(item)
      })
    }

    console.log(`[KOT] ${printer.name}: ${printerItems.length} item(s)`)

    if (printerItems.length === 0) {
      results[printer.name] = 'SKIPPED'
      continue
    }

    const buffer = buildKOTBuffer({
      billNo, tableCaption, cashierName,
      items: printerItems,
      printerLabel: printer.name
    })

    if (printer.type === 'network') {
      console.log(`[KOT] → Network ${printer.name} @ ${printer.ip}:${printer.port}`)
      jobs.push(
        sendToNetworkPrinter(buffer, printer.ip, printer.port)
          .then(() => { results[printer.name] = 'OK';           console.log(`✅ ${printer.name} OK`) })
          .catch(e  => { results[printer.name] = 'FAIL: '+e.message; console.error(`❌ ${printer.name}:`, e.message) })
      )
    } else if (printer.type === 'usb') {
      const usbName = printer.usbName || PRINTER_2_NAME
      console.log(`[KOT] → USB ${printer.name} share: "${usbName}"`)
      jobs.push(
        sendToUSBPrinter(buffer, usbName)
          .then(() => { results[printer.name] = 'OK';           console.log(`✅ ${printer.name} OK`) })
          .catch(e  => { results[printer.name] = 'FAIL: '+e.message; console.error(`❌ ${printer.name}:`, e.message) })
      )
    } else {
      results[printer.name] = 'SKIPPED (unknown type)'
    }
  }

  await Promise.allSettled(jobs)

  console.log('\n[KOT] ══ RESULTS ════════════════════════════════════')
  Object.entries(results).forEach(([k, v]) => console.log(`       ${k}: ${v}`))
  console.log('[KOT] ═══════════════════════════════════════════════\n')

  return results
}

// ══════════════════════════════════════════════════════════════
//  BUILD BILL BUFFER
// ══════════════════════════════════════════════════════════════
function buildBillBuffer({ billNo, tableCaption, roomName, cashierName, items, discount, total, settings }) {
  const b = []
  b.push(CMD.INIT, CMD.CODEPAGE_437)

  const companyName = String(settings?.companyName || 'RESTAURANT')
  b.push(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.DOUBLE_ON)
  b.push(txt(companyName.substring(0, 21) + '\n'))
  b.push(CMD.DOUBLE_OFF, CMD.BOLD_OFF)
  if (settings?.address) b.push(txt(ctr(String(settings.address).substring(0, W), W) + '\n'))
  if (settings?.phone)   b.push(txt(ctr('Ph: ' + settings.phone, W) + '\n'))
  if (settings?.gst)     b.push(txt(ctr('GSTIN: ' + settings.gst, W) + '\n'))
  b.push(CMD.LF)

  b.push(CMD.ALIGN_CENTER, CMD.BOLD_ON)
  b.push(txt(ctr('*** TAX INVOICE ***', W) + '\n'))
  b.push(CMD.BOLD_OFF)

  b.push(CMD.ALIGN_LEFT, txt(LINE))
  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-IN')
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true })
  b.push(txt(lj('Bill# : ' + (billNo      || ''), 22) + rj('Date : ' + dateStr,             20) + '\n'))
  b.push(txt(lj('Table : ' + (tableCaption|| ''), 22) + rj('Time : ' + timeStr,             20) + '\n'))
  b.push(txt(lj('Room  : ' + (roomName    || ''), 22) + rj('By   : ' + (cashierName || ''), 20) + '\n'))

  b.push(txt(LINE), CMD.BOLD_ON)
  b.push(txt(lj('ITEM', 20) + rj('QTY', 4) + rj('RATE', 9) + rj('AMT', 9) + '\n'))
  b.push(CMD.BOLD_OFF, txt(LINE))

  ;(items || []).forEach(item => {
    const name = String(item.name || '')
    const qty  = String(item.qty  || 0)
    const rate = fmt(item.rate)
    const amt  = fmt((item.qty || 0) * (item.rate || 0))
    if (name.length <= 20) {
      b.push(txt(lj(name, 20) + rj(qty, 4) + rj(rate, 9) + rj(amt, 9) + '\n'))
    } else {
      b.push(txt(name.substring(0, W) + '\n'))
      b.push(txt(lj('', 20) + rj(qty, 4) + rj(rate, 9) + rj(amt, 9) + '\n'))
    }
  })

  const subtotal = (items || []).reduce((s, i) => s + (i.qty || 0) * (i.rate || 0), 0)
  b.push(txt(LINE))
  b.push(txt(lj('Subtotal', 30) + rj(fmt(subtotal), 12) + '\n'))
  if (Number(discount) > 0) {
    b.push(txt(lj('Discount (-)', 30) + rj(fmt(discount), 12) + '\n'))
  }
  b.push(txt(DLINE))
  b.push(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.DOUBLE_ON)
  b.push(txt('TOTAL\n'))
  b.push(txt('Rs.' + fmt(total) + '\n'))
  b.push(CMD.DOUBLE_OFF, CMD.BOLD_OFF)
  b.push(txt(DLINE))

  b.push(CMD.ALIGN_CENTER)
  b.push(txt(ctr('Thank you for visiting!', W) + '\n'))
  b.push(txt(ctr('Payment at cash counter', W) + '\n'))
  if (settings?.footer1) b.push(txt(ctr(String(settings.footer1), W) + '\n'))
  if (settings?.footer2) b.push(txt(ctr(String(settings.footer2), W) + '\n'))

  b.push(CMD.LF, CMD.FEED_5, CMD.PARTIAL_CUT)
  return Buffer.concat(b)
}

// ══════════════════════════════════════════════════════════════
//  BUILD TEST BUFFER
// ══════════════════════════════════════════════════════════════
function buildTestBuffer(label) {
  const b = []
  b.push(CMD.INIT, CMD.CODEPAGE_437)
  b.push(CMD.ALIGN_CENTER, CMD.BOLD_ON)
  b.push(txt('TEST OK\n'))
  b.push(CMD.BOLD_OFF, CMD.LF)
  b.push(CMD.ALIGN_LEFT, txt(LINE))
  b.push(txt(lj('Printer', 22) + rj(String(label || '').substring(0, 20), 20) + '\n'))
  b.push(txt(LINE))
  b.push(CMD.BOLD_ON)
  b.push(txt(lj('ITEM', 30) + rj('QTY', 12) + '\n'))
  b.push(CMD.BOLD_OFF, txt(LINE))
  b.push(txt(lj('Chicken Biryani', 30) + rj('2', 12) + '\n'))
  b.push(txt(lj('Veg Fried Rice',  30) + rj('1', 12) + '\n'))
  b.push(txt(lj('Cold Drink',      30) + rj('3', 12) + '\n'))
  b.push(txt(LINE))
  const now = new Date()
  b.push(txt(lj(now.toLocaleDateString('en-IN'), 21) + rj(now.toLocaleTimeString('en-IN', { hour12: true }), 21) + '\n'))
  b.push(CMD.FEED_2, CMD.PARTIAL_CUT)
  return Buffer.concat(b)
}

// ══════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════

app.get('/health', async (req, res) => {
  // Test all active KOT printers + bill printer
  const tests = await Promise.all(
    CFG.printers
      .filter(p => p.type === 'network')
      .map(p => testNetworkPrinter(p.ip, p.port).then(r => ({ name: p.name, ...r })))
  )
  const usbTest  = await testUSBPrinter()
  const billTest = await validateBillPrinter()

  const printerStatus = {}
  tests.forEach(t => { printerStatus[t.name] = { online: t.ok, status: t.msg } })
  printerStatus['PRINTER2'] = { online: usbTest.ok, status: usbTest.msg }
  printerStatus['PRINTER3'] = { online: billTest,   status: billTest ? 'Bill printer share found' : 'Bill printer share NOT found' }

  res.json({
    ok:            true,
    server:        'Thermal Print Bridge v5.3',
    serverPort:    SERVER_PORT,
    activePrinters: CFG.printers.map(p => ({ name: p.name, type: p.type, colorIds: p.colorIds })),
    printerStatus,
    time:          new Date().toLocaleString('en-IN'),
    callerIP:      req.ip || req.socket.remoteAddress,
    serverIPs:     getLocalIPs().map(i => `${i.name}: ${i.address}`)
  })
})

app.get('/ping', async (req, res) => {
  res.json(await testNetworkPrinter())
})

// ── Dynamic test routes for all network printers ──────────────────────────────
for (const n of [1, 4, 5, 6, 7, 8, 9, 10]) {
  app.get(`/print/test/p${n}`, async (req, res) => {
    const p = CFG[`printer${n}`]
    if (!p || !p.ip || p.ip === '0.0.0.0') {
      return res.status(404).json({ ok: false, error: `PRINTER${n} not configured` })
    }
    try {
      await sendToNetworkPrinter(buildTestBuffer(`PRINTER${n} ${p.ip}`), p.ip, p.port)
      res.json({ ok: true, printer: `PRINTER${n}`, ip: p.ip, port: p.port })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })
}

app.get('/print/test', async (req, res) => {
  try {
    await sendToNetworkPrinter(buildTestBuffer(`PRINTER1 ${PRINTER_1_IP}`))
    res.json({ ok: true, printer: 'PRINTER1', message: `Test sent to ${PRINTER_1_IP}` })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/print/test/usb', async (req, res) => {
  try {
    await sendToUSBPrinter(buildTestBuffer(`PRINTER2 ${PRINTER_2_NAME}`), PRINTER_2_NAME)
    res.json({ ok: true, printer: 'PRINTER2', message: `Test sent to "${PRINTER_2_NAME}"` })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/print/test/bill', async (req, res) => {
  try {
    await sendToBillPrinter(buildTestBuffer(`PRINTER3 ${BILL_PRINTER_NAME}`))
    res.json({ ok: true, printer: 'PRINTER3', message: `Test sent to "${BILL_PRINTER_NAME}"` })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/print/kot', async (req, res) => {
  try {
    const { billNo, tableCaption, roomName, cashierName, items } = req.body
    console.log(`[KOT] Bill#${billNo}  Table:${tableCaption}  Items:${items?.length}  From:${req.ip}`)
    if (!items || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'No items to print' })
    }
    const results = await printSplitKOT({ billNo, tableCaption, roomName, cashierName, items })
    res.json({ ok: true, message: 'KOT printed', ...results })
  } catch (err) {
    console.error('[KOT] Error:', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/print/bill', async (req, res) => {
  try {
    const { billNo, tableCaption, roomName, cashierName, items, discount, total, settings } = req.body
    console.log(`[BILL] Bill#${billNo}  Table:${tableCaption}  Total:${total}`)
    if (!items || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'No items to print' })
    }
    await sendToBillPrinter(
      buildBillBuffer({ billNo, tableCaption, roomName, cashierName, items, discount, total, settings })
    )
    res.json({ ok: true, printer: 'PRINTER3', message: 'Bill printed successfully' })
  } catch (err) {
    console.error('[BILL] Error:', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ══════════════════════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════════════════════
app.listen(SERVER_PORT, '0.0.0.0', async () => {
  const ips = getLocalIPs()
  const pad = (s, len) => String(s).padEnd(len, ' ')

  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('║   THERMAL PRINT BRIDGE  v5.3  MULTI PRINTER          ║')
  console.log('╠══════════════════════════════════════════════════════╣')
  console.log(`║  Local   : http://localhost:${SERVER_PORT}                  ║`)
  ips.forEach(({ address }) => {
    console.log(`║  Network : ${pad('http://' + address + ':' + SERVER_PORT, 42)} ║`)
  })
  console.log('╠══════════════════════════════════════════════════════╣')
  console.log('║  Active KOT printers:                                ║')
  CFG.printers.forEach(p => {
    const info = p.type === 'network' ? `${p.ip}:${p.port}` : `"${p.usbName}"`
    console.log(`║    ${pad(p.name + ' [' + p.colorIds + '] ' + info, 50)} ║`)
  })
  console.log(`║  Bill : ${pad('"' + BILL_PRINTER_NAME + '" / ' + BILL_PRINTER_PORT, 45)} ║`)
  console.log('╠══════════════════════════════════════════════════════╣')
  console.log('║  GET  /health           — all printer status          ║')
  console.log('║  GET  /print/test       — test PRINTER1               ║')
  console.log('║  GET  /print/test/p1    — test PRINTER1 (network)     ║')
  console.log('║  GET  /print/test/usb   — test PRINTER2 (USB KOT)     ║')
  console.log('║  GET  /print/test/bill  — test PRINTER3 (bill)        ║')
  console.log('║  GET  /print/test/p4    — test PRINTER4               ║')
  console.log('║  GET  /print/test/p5    — test PRINTER5               ║')
  console.log('║  POST /print/kot        — split KOT all printers      ║')
  console.log('║  POST /print/bill       — bill on PRINTER3             ║')
  console.log('╚══════════════════════════════════════════════════════╝\n')

  // Startup checks
  const p1 = await testNetworkPrinter(PRINTER_1_IP, PRINTER_1_PORT)
  const p2 = await testUSBPrinter()
  const billOK = await validateBillPrinter()

  console.log(p1.ok    ? `✅ PRINTER1 ONLINE : ${p1.msg}`          : `⚠️  PRINTER1 OFFLINE: ${p1.msg}`)
  console.log(p2.ok    ? `✅ PRINTER2 READY  : ${p2.msg}`          : `⚠️  PRINTER2 NOT READY: ${p2.msg}`)
  console.log(billOK   ? `✅ PRINTER3 (BILL) SHARE FOUND`          : `❌ PRINTER3 (BILL) SHARE NOT FOUND — bill printing will fail`)
  console.log('')
})