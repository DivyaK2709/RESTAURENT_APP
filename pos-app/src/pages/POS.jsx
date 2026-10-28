import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ToastContainer, toast } from '../components/Toast'
import Modal, { modalStyle as ms } from '../components/Modal'
import { fmt, buildKOT } from '../utils/helpers'
import * as api from '../store/api'

// Resolved at runtime from /api/config (reads Windows Registry via backend)
// Falls back to same-host defaults so the app still works if fetch fails
let PRINT_SERVER = ''
let API_BASE     = ''

async function resolveServerUrls() {
  try {
    const serverIp = localStorage.getItem('posServerIp') || window.location.hostname
    const base     = `http://${serverIp}`
    const res      = await fetch(`${base}:3001/api/config`)
    const cfg      = await res.json()
    API_BASE     = `${base}:${cfg.backendPort}`
    PRINT_SERVER = `${base}:${cfg.printServerPort}`
    console.log('[POS] registry config loaded — API:', API_BASE, 'Print:', PRINT_SERVER)
  } catch (_) {
    const h      = window.location.hostname
    API_BASE     = `http://${h}:3001`
    PRINT_SERVER = `http://${h}:6543`
    console.warn('[POS] /api/config unreachable — using default ports 3001/6543')
  }
}

// Kick off URL resolution immediately (before component mounts)
const _configReady = resolveServerUrls()

async function thermalPrint(endpoint, payload) {
  const res = await fetch(`${PRINT_SERVER}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Print failed')
  return data
}

function getColorId(item) {
  const v = item.colorId ?? item.ColorId ?? item.color_id ?? null
  return v !== null ? Number(v) : null
}

function buildBillSlip(billNo, table, room, cashier, items, discount, total, settings) {
  const LINE = '--------------------------------'
  const ljust = (s, w) => String(s || '').substring(0, w).padEnd(w, ' ')
  const rjust = (s, w) => String(s || '').substring(0, w).padStart(w, ' ')
  const center = (s, w) => {
    const t = String(s || '').substring(0, w)
    const left = Math.max(0, Math.floor((w - t.length) / 2))
    return ' '.repeat(left) + t
  }
  let r = ''
  r += center(settings?.companyName || '', 32) + '\n'
  r += center(settings?.address || '', 32) + '\n'
  r += LINE + '\n'
  r += 'Bill No : ' + billNo + '\n'
  r += 'Date    : ' + new Date().toLocaleDateString('en-IN') + '\n'
  r += 'Time    : ' + new Date().toLocaleTimeString('en-IN') + '\n'
  r += 'Room    : ' + (room || '') + '\n'
  r += 'Table   : ' + (table || '') + '\n'
  r += 'Waiter  : ' + (cashier || '') + '\n'
  r += LINE + '\n'
  r += ljust('ITEM', 16) + rjust('QTY', 5) + rjust('RATE', 5) + rjust('AMT', 6) + '\n'
  r += LINE + '\n'
  items.forEach(i => {
    const amt = i.qty * i.rate
    r += ljust(i.name, 16) + rjust(i.qty, 5) + rjust(fmt(i.rate), 5) + rjust(fmt(amt), 6) + '\n'
  })
  r += LINE + '\n'
  const subtotal = items.reduce((s, i) => s + i.qty * i.rate, 0)
  r += ljust('SUBTOTAL', 22) + rjust(fmt(subtotal), 10) + '\n'
  if (discount > 0) r += ljust('DISCOUNT', 22) + rjust(fmt(discount), 10) + '\n'
  r += ljust('TOTAL', 22) + rjust(fmt(total), 10) + '\n'
  r += LINE + '\n'
  r += center('PLEASE PAY AT CASH COUNTER', 32) + '\n'
  r += center('THANK YOU VISIT AGAIN', 32) + '\n'
  return r
}

const BACK_BTN_STYLE = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 800,
  letterSpacing: 1, cursor: 'pointer', background: '#00c8ff', color: '#000',
  border: '2px solid #00e5ff', boxShadow: '0 0 0 0 transparent',
  outline: 'none', transition: 'none', whiteSpace: 'nowrap',
}

export default function POS() {
  const nav  = useNavigate()
  const user = JSON.parse(sessionStorage.getItem('posUser') || '{}')

  const [rooms, setRooms]         = useState([])
  const [tables, setTables]       = useState([])
  const [categories, setCats]     = useState([])
  const [items, setItems]         = useState([])
  const [filteredItems, setFI]    = useState([])
  const [settings, setSettings]   = useState({})

  const [currentRoom, setCurrentRoom]   = useState(null)
  const [currentTable, setCurrentTable] = useState(null)
  const [currentCat, setCurrentCat]     = useState(null)
  const [view, setView]                 = useState('rooms')

  const [cart, setCart]           = useState([])
  const [discount, setDiscount]   = useState(0)
  const [qty, setQty]             = useState(1)
  const [search, setSearch]       = useState('')
  const [billNo, setBillNo]       = useState('00001')
  const [isHeld, setIsHeld]       = useState(false)
  const [heldInvNo, setHeldInvNo] = useState(null)

  const [kotModal, setKotModal]   = useState(false)
  const [kotText, setKotText]     = useState('')
  const [billModal, setBillModal] = useState(false)
  const [billText, setBillText]   = useState('')

  const [activeTableRef, setActiveTableRef] = useState(null)
  const [activeRoomRef, setActiveRoomRef]   = useState(null)
  const [lockWarning, setLockWarning]       = useState(null)

  const subtotal = cart.reduce((s, i) => s + i.qty * i.rate, 0)
  const total    = Math.max(0, subtotal - discount)
  const isMobile = window.innerWidth <= 600

  useEffect(() => {
    async function load() {
      await _configReady
      try {
        const [rm, cats, stg, ctr] = await Promise.all([
          api.getRooms(), api.getCategories(), api.getSettings(), api.getBillCounter()
        ])
        setRooms(rm.data)
        setCats(cats.data)
        setSettings(stg.data)
        setBillNo(String(ctr.data.counter).padStart(5, '0'))
      } catch { toast('Cannot connect to server!', 'error') }
    }
    load()
  }, [])

  useEffect(() => {
    api.getItems(currentCat).then(r => { setItems(r.data); setFI(r.data) }).catch(() => {})
  }, [currentCat])

  useEffect(() => {
    const q = search.toLowerCase()
    setFI(items.filter(i => i.name.toLowerCase().includes(q)))
  }, [search, items])

  // ── TABLE LOCK helpers ──────────────────────────────────────────────────────
  async function lockTable(tableId) {
    try {
      const res = await fetch(`${API_BASE}/api/tables/${tableId}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedBy: user.name || 'Waiter' })
      })
      const data = await res.json()
      if (data.warning) {
        setLockWarning({ lockedBy: data.lockedBy })
        return true
      }
      return false
    } catch (e) {
      console.error('Lock failed (non-critical):', e.message)
      return false
    }
  }

  async function unlockTable(tableId) {
    if (!tableId) return
    try {
      await fetch(`${API_BASE}/api/tables/${tableId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (e) {
      console.error('Unlock failed (non-critical):', e.message)
    }
  }

  async function selectTable(table) {
    setCurrentCat(null)
    setSearch('')

    const warned = await lockTable(table.id)
    if (warned) return

    setCurrentTable(table)
    setActiveTableRef(table)
    setView('items')
    setIsHeld(false)
    setHeldInvNo(null)
    setCart([])
    setDiscount(0)

    if (table.status === 'occupied') {
      try {
        const res = await api.getHeldBill(table.id)
        if (res.data.held && res.data.items.length > 0) {
          const deduped = []
          res.data.items.forEach(item => {
            const ex = deduped.find(d => d.id === item.id && d.kotPrinted === item.kotPrinted)
            if (ex) { ex.qty += item.qty }
            else { deduped.push({ ...item, kotPrinted: item.kotPrinted || false }) }
          })
          setCart(deduped)
          setDiscount(Number(res.data.discount) || 0)
          setHeldInvNo(res.data.invNo)
          setBillNo(String(res.data.invNo).padStart(5, '0'))
          setIsHeld(true)
          toast(`Resumed bill #${res.data.invNo}`, 'info')
        }
      } catch (e) { console.error('Load held bill:', e.message) }
    }
    api.getItems(null).then(r => { setItems(r.data); setFI(r.data) })
  }

  function selectRoom(room) {
    setCurrentRoom(room)
    setActiveRoomRef(room)
    setCurrentTable(null)
    setActiveTableRef(null)
    setCart([])
    setDiscount(0)
    setIsHeld(false)
    setHeldInvNo(null)
    setView('tables')
    api.getTables(room.id).then(r => setTables(r.data))
  }

  function backToRooms() {
    setCurrentRoom(null); setActiveRoomRef(null)
    setCurrentTable(null); setActiveTableRef(null)
    setView('rooms'); setCart([]); setDiscount(0)
    setIsHeld(false); setHeldInvNo(null)
  }

  function backToTables() {
    unlockTable(currentTable?.id)
    setCurrentTable(null); setActiveTableRef(null)
    setView('tables'); setIsHeld(false); setHeldInvNo(null)
    if (currentRoom) api.getTables(currentRoom.id).then(r => setTables(r.data))
  }

  async function refreshTablesOnly() {
    if (currentRoom) {
      const r = await api.getTables(currentRoom.id)
      setTables(r.data)
    }
  }

  // ── addToCart — NO autoHold, only saves on HOLD or KOT click ───────────────
  function addToCart(item) {
    if (!currentTable) { toast('Select a table first!', 'error'); return }
    const q       = parseInt(qty) || 1
    const colorId = getColorId(item)

    setCart(prev => {
      const pendingIndex = prev.findIndex(c => c.id === item.id && !c.kotPrinted)
      const printedIndex = prev.findIndex(c => c.id === item.id &&  c.kotPrinted)

      if (pendingIndex !== -1) {
        return prev.map((c, i) => i === pendingIndex ? { ...c, qty: c.qty + q } : c)
      } else if (printedIndex !== -1) {
        return [...prev, {
          id: item.id, name: item.name, qty: q, rate: item.price,
          unit: item.unit, barcode: item.barcode, colorId, kotPrinted: false
        }]
      } else {
        return [...prev, {
          id: item.id, name: item.name, qty: q, rate: item.price,
          unit: item.unit, barcode: item.barcode, colorId, kotPrinted: false
        }]
      }
    })
    setQty(1)
    toast(`${item.name} added`, 'success')
  }

  // ── removeFromCart — NO autoHold ────────────────────────────────────────────
  const removeFromCart = id => {
    setCart(prev => {
      const item = prev.find(c => c.id === id)
      if (item && item.kotPrinted) {
        toast('⚠️ Cannot remove — already sent to kitchen!', 'error')
        return prev
      }
      return prev.filter(c => c.id !== id)
    })
  }

  // ── changeQty — NO autoHold ─────────────────────────────────────────────────
  function changeQty(id, delta) {
    setCart(prev => {
      const item = prev.find(c => c.id === id)
      if (item && item.kotPrinted && delta < 0) {
        toast('⚠️ Cannot reduce — already sent to kitchen!', 'error')
        return prev
      }
      return prev
        .map(c => c.id === id ? { ...c, qty: Math.max(0, c.qty + delta) } : c)
        .filter(c => c.qty > 0)
    })
  }

  function clearBill() {
    const sentItems = cart.filter(i => i.kotPrinted)
    if (sentItems.length > 0 && sentItems.length === cart.length) {
      toast('⚠️ All items already sent to kitchen. Use HOLD or PRINT BILL.', 'error')
      return
    }
    const remaining = cart.filter(i => i.kotPrinted)
    setCart(remaining)
    setDiscount(0)
    setQty(1)
    if (remaining.length === 0) { setIsHeld(false); setHeldInvNo(null) }
    toast(remaining.length > 0 ? `Unsent items cleared. ${remaining.length} KOT item(s) retained.` : 'Bill cleared', 'info')
  }

  async function printKOT() {
    if (!cart.length) { toast('Cart is empty', 'error'); return }
    if (!currentTable) { toast('Select a table first', 'error'); return }
    const newItems = cart.filter(i => !i.kotPrinted)
    if (!newItems.length) { toast('All items already sent to kitchen', 'info'); return }
    try {
      const res = await api.saveKOT({
        billNo, tableCaption: currentTable.caption,
        roomName: currentRoom?.name, cashierName: user.name,
        items: newItems, tableId: currentTable.id
      })
      const realBillNo = res?.data?.invNo
        ? String(res.data.invNo).padStart(5, '0')
        : billNo
      if (res?.data?.invNo) setBillNo(realBillNo)

      await thermalPrint('/print/kot', {
        billNo: realBillNo,
        tableCaption: currentTable.caption,
        roomName: currentRoom?.name, cashierName: user.name, items: newItems
      })
      const printedCart = cart.map(c => ({ ...c, kotPrinted: true }))
      setCart(printedCart)
      try {
        await api.holdBill({ tableId: currentTable.id, items: printedCart, discount, total })
      } catch (he) { console.error(he) }
      await refreshTablesOnly()
      toast('✅ KOT Printed Successfully!', 'success')
    } catch (e) {
      console.error(e)
      const kot = buildKOT(billNo, currentTable.caption, currentRoom?.name, user.name, newItems)
      const printedCart = cart.map(c => ({ ...c, kotPrinted: true }))
      setCart(printedCart)
      doPrint(kot)
      toast('⚠️ Used browser print (start print-server.js for direct print)', 'info')
    }
  }

  async function printBill() {
    if (!cart.length) { toast('Cart is empty', 'error'); return }
    if (!currentTable) { toast('Select a table first', 'error'); return }

    let realBillNo = billNo
    try {
      const held = await api.getHeldBill(currentTable.id)
      if (held?.data?.invNo) {
        realBillNo = String(held.data.invNo).padStart(5, '0')
        setBillNo(realBillNo)
      }
    } catch (_) {}

    try {
      await api.holdBill({ tableId: currentTable.id, items: cart, discount, total })
      await refreshTablesOnly()
    } catch (e) { console.error('Hold on print:', e.message) }
    try {
      await thermalPrint('/print/bill', {
        billNo: realBillNo,
        tableCaption: currentTable.caption,
        roomName: currentRoom?.name, cashierName: user.name,
        items: cart, discount, total, settings
      })
      const slip = buildBillSlip(realBillNo, currentTable.caption, currentRoom?.name, user.name, cart, discount, total, settings)
      setBillText(slip); setBillModal(true)
      toast('✅ Bill Printed!', 'success')
    } catch (e) {
      console.error(e)
      const slip = buildBillSlip(realBillNo, currentTable.caption, currentRoom?.name, user.name, cart, discount, total, settings)
      setBillText(slip); setBillModal(true)
      toast('⚠️ Used browser print (start print-server.js for direct print)', 'info')
    }
  }

  async function holdBill() {
    if (!cart.length) { toast('Cart is empty', 'error'); return }
    if (!currentTable) { toast('Select a table', 'error'); return }
    try {
      await api.holdBill({ tableId: currentTable.id, items: cart, discount, total })
      unlockTable(currentTable.id)
      toast(`Bill held for ${currentTable.caption}`, 'info')
      setCart([]); setDiscount(0); setQty(1)
      setIsHeld(false); setHeldInvNo(null)
      backToTables()
    } catch (e) { toast('Hold failed: ' + e.message, 'error') }
  }

  async function settleBill() {
    try {
      if (currentTable) {
        await api.settleBill({ tableId: currentTable.id })
        unlockTable(currentTable.id)
        toast(`Table ${currentTable.caption} is now FREE`, 'success')
      }
    } catch (e) { toast('Settle failed: ' + e.message, 'error') }
    finally {
      setBillModal(false)
      setCart([]); setDiscount(0); setQty(1)
      setIsHeld(false); setHeldInvNo(null)
      api.getBillCounter().then(r => {
        setBillNo(String(r.data.counter).padStart(5, '0'))
      }).catch(() => {})
      backToTables()
    }
  }

  function doPrint(text) {
    if (window.Capacitor || window.cordova) { alert(text); return }
    const w = window.open('', '_blank', 'width=280,height=420')
    w.document.write(`<html><head><title>Print</title><style>
      @page{size:80mm auto;margin:2mm;}
      body{width:72mm;font-family:monospace;font-size:11px;white-space:pre-wrap;margin:0;padding:2px;line-height:1.2;}
      button{margin-top:10px;width:100%;padding:8px;font-size:14px;}
      @media print{button{display:none;}body{margin:0;padding:0;}}
    </style></head><body>${text}<br><button onclick="window.print()">🖨️ PRINT</button></body></html>`)
    w.document.close(); w.focus()
    setTimeout(() => { w.print() }, 500)
  }

  const KotBadge = () => (
    <span style={{
      display: 'inline-block', background: '#16a34a', color: '#fff',
      fontSize: 9, fontWeight: 800, borderRadius: 3,
      padding: '1px 5px', marginRight: 5, letterSpacing: 0.5,
    }}>KOT✓</span>
  )

  const LockedIcon = () => (
    <span title="Sent to kitchen — cannot remove" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 20, height: 20, borderRadius: 3,
      background: 'rgba(255,200,0,.12)', border: '1px solid rgba(255,200,0,.3)',
      color: '#f59e0b', fontSize: 11, cursor: 'not-allowed', flexShrink: 0
    }}>🔒</span>
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE LAYOUT
  // ═══════════════════════════════════════════════════════════════════════════
  if (isMobile) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
        <ToastContainer />

        <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', height: 50, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8, flexShrink: 0 }}>
          <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 12, color: 'var(--accent)', letterSpacing: 2 }}>YNOT</div>
          {view !== 'rooms' && (
            <button
              onClick={view === 'tables' ? backToRooms : view === 'items' ? backToTables : view === 'cart' ? () => setView('items') : backToTables}
              style={{ ...BACK_BTN_STYLE, padding: '4px 10px', fontSize: 11 }}>
              ← BACK
            </button>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>#{billNo}</div>
          {cart.length > 0 && (
            <button onClick={() => setView('cart')}
              style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent2)', color: '#fff', border: 'none', cursor: 'pointer' }}>
              🛒 {cart.length} · ₹{fmt(total)}
            </button>
          )}
          <button onClick={clearBill}
            style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer' }}>
            CLR
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {view === 'rooms' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10, textAlign: 'center' }}>SELECT ROOM</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                {rooms.map(r => (
                  <button key={r.id} onClick={() => selectRoom(r)}
                    style={{ padding: '20px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 28 }}>{r.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{r.name}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {view === 'tables' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 10, textAlign: 'center', fontWeight: 700 }}>
                {currentRoom?.icon} {currentRoom?.name} — SELECT TABLE
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                {tables.map((t, idx) => (
                  <button key={`${t.id}-${idx}`} onClick={() => selectTable(t)}
                    style={{
                      padding: '14px 6px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                      border: `2px solid ${t.status === 'occupied' ? 'var(--accent2)' : 'var(--border)'}`,
                      background: t.status === 'occupied' ? 'rgba(255,107,53,.15)' : 'var(--surface2)',
                      color: t.status === 'occupied' ? 'var(--accent2)' : 'var(--text2)',
                    }}>
                    <div style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{t.caption}</div>
                    <div style={{ fontSize: 9 }}>{t.status.toUpperCase()}</div>
                    {t.status === 'occupied' && <div style={{ fontSize: 9, color: 'var(--gold)' }}>RESUME</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {view === 'items' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ background: 'var(--surface2)', padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--accent2)', fontWeight: 700 }}>
                  {currentRoom?.name} | {currentTable?.caption}
                  {isHeld && <span style={{ color: 'var(--gold)', marginLeft: 8 }}>⏸ RESUMED</span>}
                </div>
                <button onClick={() => setView('cart')}
                  style={{ padding: '4px 10px', borderRadius: 6, background: 'var(--accent)', color: '#000', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                  CART ({cart.length})
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, padding: '6px 8px', overflowX: 'auto', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <button onClick={() => setCurrentCat(null)}
                  style={{ padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', border: `1px solid ${!currentCat ? 'var(--accent)' : 'var(--border)'}`, background: !currentCat ? 'var(--accent)' : 'transparent', color: !currentCat ? '#000' : 'var(--text2)' }}>
                  ALL
                </button>
                {categories.map(c => (
                  <button key={c.id} onClick={() => setCurrentCat(c.id)}
                    style={{ padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', border: `1px solid ${currentCat === c.id ? 'var(--accent)' : 'var(--border)'}`, background: currentCat === c.id ? 'var(--accent)' : 'transparent', color: currentCat === c.id ? '#000' : 'var(--text2)' }}>
                    {c.name}
                  </button>
                ))}
              </div>
              <div style={{ padding: '6px 8px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <input style={{ width: '100%', padding: '7px 10px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
                  placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, alignContent: 'start' }}>
                {filteredItems.map(item => (
                  <div key={item.id} onClick={() => addToCart(item)}
                    style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 8px', textAlign: 'center', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{item.name}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--gold)' }}>₹{fmt(item.price)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text2)' }}>{item.cat_name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'cart' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--accent)', background: 'var(--surface)', flexShrink: 0 }}>
                ORDER — {currentRoom?.name} | {currentTable?.caption}
                {isHeld && <span style={{ color: 'var(--gold)', fontSize: 11, marginLeft: 8 }}>⏸ #{heldInvNo}</span>}
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {cart.length === 0
                  ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--text2)' }}>Cart is empty</div>
                  : cart.map((item, idx) => (
                    <div key={`mcart-${item.id}-${idx}`} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 12px', borderBottom: '1px solid var(--border)',
                      background: item.kotPrinted ? 'rgba(22,163,74,.08)' : 'transparent'
                    }}>
                      <div style={{ flex: 1, fontSize: 12 }}>
                        {item.kotPrinted && <KotBadge />}
                        {item.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button onClick={() => changeQty(item.id, -1)} disabled={item.kotPrinted}
                          style={{ width: 26, height: 26, borderRadius: 4, background: item.kotPrinted ? 'rgba(100,100,100,.15)' : 'var(--surface3)', color: item.kotPrinted ? '#555' : 'var(--text)', fontSize: 14, border: '1px solid var(--border)', cursor: item.kotPrinted ? 'not-allowed' : 'pointer', opacity: item.kotPrinted ? 0.4 : 1 }}>-</button>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--accent)', minWidth: 24, textAlign: 'center' }}>{item.qty}</span>
                        <button onClick={() => changeQty(item.id, 1)} style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--surface3)', color: 'var(--text)', fontSize: 14, border: '1px solid var(--border)', cursor: 'pointer' }}>+</button>
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--gold)', minWidth: 60, textAlign: 'right' }}>₹{fmt(item.qty * item.rate)}</div>
                      {item.kotPrinted
                        ? <LockedIcon />
                        : <div onClick={() => removeFromCart(item.id)} style={{ color: 'var(--danger)', fontSize: 18, cursor: 'pointer', paddingLeft: 4 }}>✕</div>
                      }
                    </div>
                  ))
                }
              </div>
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text2)' }}>Subtotal</span>
                  <span style={{ fontFamily: 'var(--mono)' }}>₹{fmt(subtotal)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 11, color: 'var(--text2)', width: 72, flexShrink: 0 }}>Discount ₹</label>
                  <input style={{ flex: 1, padding: '5px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)' }}
                    type="number" value={discount} min={0} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700 }}>
                  <span>TOTAL</span>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--gold)' }}>₹{fmt(total)}</span>
                </div>
                <button onClick={printKOT} style={{ padding: 13, borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', background: 'var(--accent2)', color: '#fff', border: 'none' }}>
                  * SEND TO KITCHEN (KOT)
                </button>
                <button onClick={printBill} style={{ padding: 13, borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: '#000', border: 'none' }}>
                  # PRINT BILL
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={holdBill} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'transparent', color: 'var(--gold)', border: '1px solid var(--gold)' }}>⏸ HOLD</button>
                  <button onClick={clearBill} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' }}>✕ CLEAR</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'center' }}>💡 Payment collected at cash counter</div>
              </div>
            </div>
          )}
        </div>

        <Modal open={kotModal} onClose={() => setKotModal(false)} title="* KITCHEN ORDER TICKET"
          onOk={() => { doPrint(kotText); setKotModal(false) }} okLabel="🖨️ PRINT KOT">
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--surface2)', borderRadius: 8, padding: 14, maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre', lineHeight: 1.7 }}>{kotText}</div>
        </Modal>

        {billModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ background: 'var(--surface)', borderRadius: '12px 12px 0 0', padding: 16, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}># BILL</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--surface2)', borderRadius: 8, padding: 12, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre', lineHeight: 1.7 }}>{billText}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                <button onClick={settleBill} style={{ padding: 14, borderRadius: 8, background: '#22c55e', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none' }}>✅ PAYMENT RECEIVED — FREE TABLE</button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => doPrint(billText)} style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--accent)', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none' }}>🖨️ REPRINT</button>
                  <button onClick={() => setBillModal(false)} style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>CLOSE</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TABLE LOCK WARNING MODAL */}
        {lockWarning && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20
          }}>
            <div style={{
              background: '#1a0000', border: '2px solid #ef4444', borderRadius: 14,
              padding: 28, maxWidth: 420, width: '100%', textAlign: 'center',
              boxShadow: '0 0 40px rgba(239,68,68,0.4)'
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#ef4444', letterSpacing: 1, marginBottom: 10 }}>
                TABLE ALREADY OPEN!
              </div>
              <div style={{ fontSize: 14, color: '#fca5a5', marginBottom: 6, lineHeight: 1.6 }}>
                This table is currently open by:
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#fbbf24', marginBottom: 16, fontFamily: 'var(--mono)' }}>
                "{lockWarning.lockedBy}"
              </div>
              <div style={{ fontSize: 13, color: '#f87171', marginBottom: 24, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
                🚫 This table is <strong>blocked</strong> until they close or finish billing.<br />
                Please wait or choose a different table.
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => { setLockWarning(null); backToTables() }}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 8, background: '#374151', color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                  ← GO BACK
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DESKTOP LAYOUT
  // ═══════════════════════════════════════════════════════════════════════════
  const S = {
    screen:     { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' },
    header:     { background: 'var(--surface)', borderBottom: '1px solid var(--border)', height: 50, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, flexShrink: 0 },
    body:       { flex: 1, display: 'flex', overflow: 'hidden' },
    roomPanel:  { width: 82, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto', flexShrink: 0 },
    roomTab: a  => ({ padding: '14px 4px', textAlign: 'center', fontSize: 11, fontWeight: 700, cursor: 'pointer', borderBottom: '1px solid var(--border)', lineHeight: 1.3, background: a ? 'var(--accent)' : 'transparent', color: a ? '#000' : 'var(--text2)' }),
    center:     { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    catBar:     { background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '6px 8px', gap: 6, flexShrink: 0, overflowX: 'auto' },
    catBtn: a   => ({ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', border: `1px solid ${a ? 'var(--accent)' : 'var(--border)'}`, background: a ? 'var(--accent)' : 'transparent', color: a ? '#000' : 'var(--text2)' }),
    tableGrid:  { flex: 1, padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 8, overflowY: 'auto', alignContent: 'start' },
    tableBtn: s => ({ padding: '12px 6px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, border: `2px solid ${s === 'occupied' ? 'var(--accent2)' : 'var(--border)'}`, background: s === 'occupied' ? 'rgba(255,107,53,.15)' : 'var(--surface2)', color: s === 'occupied' ? 'var(--accent2)' : 'var(--text2)' }),
    itemGrid:   { flex: 1, padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(116px,1fr))', gap: 8, overflowY: 'auto', alignContent: 'start' },
    itemCard:   { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 8px', textAlign: 'center', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5 },
    cart:       { width: 300, background: 'var(--surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 },
    cartHeader: { padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    cartColHead:{ background: 'var(--surface3)', padding: '4px 8px', fontSize: 10, color: 'var(--text2)', display: 'grid', gridTemplateColumns: '1fr 56px 68px 22px', gap: 2 },
    cartRow:    { display: 'grid', gridTemplateColumns: '1fr 56px 68px 22px', alignItems: 'center', gap: 2, padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 12 },
    cartFooter: { borderTop: '1px solid var(--border)', padding: '10px', display: 'flex', flexDirection: 'column', gap: 8 },
  }

  return (
    <div style={S.screen}>
      <ToastContainer />

      <div style={S.header}>
        <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 13, color: 'var(--accent)', letterSpacing: 2 }}>POS</div>
        <button onClick={() => nav('/dashboard')} style={BACK_BTN_STYLE}
          onMouseEnter={e => { e.currentTarget.style.background = '#33d6ff'; e.currentTarget.style.boxShadow = '0 0 16px rgba(0,200,255,.7)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#00c8ff'; e.currentTarget.style.boxShadow = '0 0 0 0 transparent'; e.currentTarget.style.transform = 'translateY(0)' }}>
          <span style={{ fontSize: 15 }}>←</span>
          <span>BACK</span>
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--gold)' }}>BILL# {billNo}</div>
        <div style={{ width: 10 }} />
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>{user.name?.toUpperCase()}</div>
        <div style={{ width: 10 }} />
        <button onClick={clearBill} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'var(--danger)', color: '#fff', border: 'none' }}>CLEAR</button>
      </div>

      <div style={S.body}>
        <div style={S.roomPanel}>
          {rooms.map(r => (
            <div key={r.id} style={S.roomTab(currentRoom?.id === r.id)} onClick={() => selectRoom(r)}>
              <div style={{ fontSize: 20 }}>{r.icon}</div>
              <div style={{ fontSize: 9, marginTop: 2 }}>{r.name}</div>
            </div>
          ))}
        </div>

        <div style={S.center}>
          {view === 'items' && (
            <>
              <div style={S.catBar}>
                <button style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, background: 'var(--surface3)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0 }} onClick={backToTables}>← TABLES</button>
                <button style={S.catBtn(!currentCat)} onClick={() => setCurrentCat(null)}>ALL</button>
                {categories.map(c => (
                  <button key={c.id} style={S.catBtn(currentCat === c.id)} onClick={() => setCurrentCat(c.id)}>{c.name}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <span>🔍</span>
                <input style={{ flex: 1, padding: '7px 10px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13 }}
                  placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>QTY:</span>
                <input style={{ width: 52, padding: '6px 4px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--accent)', fontFamily: 'var(--mono)', textAlign: 'center', fontSize: 14 }}
                  type="number" value={qty} min={1} onChange={e => setQty(e.target.value)} />
              </div>
            </>
          )}

          {view === 'tables' && (
            <div style={S.tableGrid}>
              {tables.length === 0
                ? <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 14 }}>No tables found</div>
                : tables.map((t, idx) => (
                  <button key={`${t.id}-${idx}`} style={S.tableBtn(t.status)} onClick={() => selectTable(t)}>
                    <div style={{ fontSize: 15, fontFamily: 'var(--mono)', fontWeight: 700 }}>{t.caption}</div>
                    <div style={{ fontSize: 9 }}>{t.status.toUpperCase()}</div>
                    {t.status === 'occupied' && <div style={{ fontSize: 9, color: 'var(--gold)' }}>TAP TO RESUME</div>}
                  </button>
                ))
              }
            </div>
          )}

          {view === 'rooms' && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 14 }}>
              ← Select a room
            </div>
          )}

          {view === 'items' && (
            <div style={S.itemGrid}>
              {filteredItems.map(item => (
                <div key={item.id} style={S.itemCard}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = '' }}
                  onClick={() => addToCart(item)}>
                  <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{item.name}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--gold)' }}>₹{fmt(item.price)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text2)' }}>{item.cat_name}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={S.cart}>
          <div style={S.cartHeader}>
            ORDER
            <div style={{ fontSize: 11, color: 'var(--accent2)', fontFamily: 'var(--mono)' }}>
              {currentTable ? `${currentRoom?.name} | ${currentTable.caption}` : '— select table —'}
            </div>
          </div>

          {isHeld && (
            <div style={{ padding: '4px 8px' }}>
              <div style={{ background: 'rgba(255,107,53,.15)', border: '1px solid var(--accent2)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--accent2)', fontWeight: 700, textAlign: 'center' }}>⏸ RESUMED BILL #{heldInvNo}</div>
            </div>
          )}

          <div style={S.cartColHead}>
            <div>ITEM</div><div style={{ textAlign: 'center' }}>QTY</div><div style={{ textAlign: 'right' }}>AMT</div><div />
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {cart.length === 0
              ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{currentTable ? 'Add items from menu' : 'Select a table first'}</div>
              : cart.map((item, idx) => (
                <div key={`cart-${item.id}-${idx}`} style={{
                  ...S.cartRow,
                  background: item.kotPrinted ? 'rgba(22,163,74,.07)' : 'transparent',
                  borderLeft: item.kotPrinted ? '3px solid #16a34a' : '3px solid transparent',
                }}>
                  <div style={{ fontSize: 11, lineHeight: 1.4, overflow: 'hidden' }}>
                    {item.kotPrinted && <KotBadge />}
                    {item.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
                    <button onClick={() => changeQty(item.id, -1)} disabled={item.kotPrinted}
                      style={{ width: 20, height: 20, borderRadius: 3, background: item.kotPrinted ? 'transparent' : 'var(--surface3)', color: item.kotPrinted ? '#444' : 'var(--text)', fontSize: 13, border: '1px solid var(--border)', cursor: item.kotPrinted ? 'not-allowed' : 'pointer', opacity: item.kotPrinted ? 0.35 : 1 }}>-</button>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: item.kotPrinted ? '#16a34a' : 'var(--accent)', minWidth: 22, textAlign: 'center', fontWeight: item.kotPrinted ? 700 : 400 }}>{item.qty}</span>
                    <button onClick={() => changeQty(item.id, 1)}
                      style={{ width: 20, height: 20, borderRadius: 3, background: 'var(--surface3)', color: 'var(--text)', fontSize: 13, border: '1px solid var(--border)', cursor: 'pointer' }}>+</button>
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>₹{fmt(item.qty * item.rate)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {item.kotPrinted
                      ? <LockedIcon />
                      : <span style={{ color: 'var(--danger)', fontSize: 15, cursor: 'pointer' }} onClick={() => removeFromCart(item.id)}>✕</span>
                    }
                  </div>
                </div>
              ))
            }
          </div>

          <div style={S.cartFooter}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text2)' }}>Subtotal</span>
              <span style={{ fontFamily: 'var(--mono)' }}>₹{fmt(subtotal)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 11, color: 'var(--text2)', width: 68, flexShrink: 0 }}>Discount ₹</label>
              <input style={{ flex: 1, padding: '5px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)' }}
                type="number" value={discount} min={0} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700 }}>
              <span style={{ color: 'var(--text)' }}>TOTAL</span>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--gold)', fontSize: 20 }}>₹{fmt(total)}</span>
            </div>
            <button onClick={printKOT} style={{ padding: 13, borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--accent2)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              * SEND TO KITCHEN (KOT)
            </button>
            <button onClick={printBill} style={{ padding: 13, borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: '#000', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              # PRINT BILL
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={holdBill} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'transparent', color: 'var(--gold)', border: '1px solid var(--gold)' }}>⏸ HOLD</button>
              <button onClick={clearBill} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' }}>✕ CLEAR</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'center' }}>💡 Payment collected at cash counter</div>
          </div>
        </div>
      </div>

      <Modal open={kotModal} onClose={() => setKotModal(false)} title="* KITCHEN ORDER TICKET"
        onOk={() => { doPrint(kotText); setKotModal(false) }} okLabel="🖨️ PRINT KOT">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--surface2)', borderRadius: 8, padding: 14, maxHeight: 360, overflowY: 'auto', whiteSpace: 'pre', lineHeight: 1.7 }}>{kotText}</div>
      </Modal>

      {billModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 460 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', marginBottom: 14 }}># BILL — CASH COUNTER COPY</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--surface2)', borderRadius: 8, padding: 14, maxHeight: 360, overflowY: 'auto', whiteSpace: 'pre', lineHeight: 1.7 }}>{billText}</div>
            <div style={{ fontSize: 12, color: 'var(--accent2)', marginTop: 8, marginBottom: 12, textAlign: 'center', fontWeight: 700 }}>⚠️ Payment collected separately.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={settleBill} style={{ width: '100%', padding: 14, borderRadius: 8, background: '#22c55e', color: '#000', fontSize: 15, fontWeight: 700, cursor: 'pointer', border: 'none' }}>✅ PAYMENT RECEIVED — FREE TABLE</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => doPrint(billText)} style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--accent)', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none' }}>🖨️ REPRINT</button>
                <button onClick={() => setBillModal(false)} style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, cursor: 'pointer' }}>CLOSE</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TABLE LOCK WARNING MODAL — Desktop */}
      {lockWarning && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20
        }}>
          <div style={{
            background: '#1a0000', border: '2px solid #ef4444', borderRadius: 14,
            padding: 28, maxWidth: 420, width: '100%', textAlign: 'center',
            boxShadow: '0 0 40px rgba(239,68,68,0.4)'
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#ef4444', letterSpacing: 1, marginBottom: 10 }}>
              TABLE ALREADY OPEN!
            </div>
            <div style={{ fontSize: 14, color: '#fca5a5', marginBottom: 6, lineHeight: 1.6 }}>
              This table is currently open by:
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fbbf24', marginBottom: 16, fontFamily: 'var(--mono)' }}>
              "{lockWarning.lockedBy}"
            </div>
            <div style={{ fontSize: 13, color: '#f87171', marginBottom: 24, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
              🚫 This table is <strong>blocked</strong> until they close or finish billing.<br />
              Please wait or choose a different table.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setLockWarning(null); backToTables() }}
                style={{ flex: 1, padding: '12px 0', borderRadius: 8, background: '#374151', color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                ← GO BACK
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}