
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ToastContainer, toast } from '../components/Toast'
import * as api from '../store/api'

const S = {
  screen: { height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  header: { background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 16px', height: 50, display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 },
  logo: { fontFamily: "'Orbitron',sans-serif", fontSize: 14, color: 'var(--accent)', letterSpacing: 2 },
  body: { flex: 1, overflowY: 'auto', padding: '16px 12px' },
  wrap: { maxWidth: 860, margin: '0 auto' },
  section: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 16px', marginBottom: 16 },
  h2: { fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 14, letterSpacing: 1 },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  input: { flex: 1, minWidth: 130, padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font)' },
  select: { flex: 1, minWidth: 130, padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font)' },
  addBtn: { padding: '8px 16px', borderRadius: 'var(--radius)', background: '#7cfc00', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none' },
  saveBtn: { padding: '8px 16px', borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none' },
  dangerBtn: { padding: '8px 16px', borderRadius: 'var(--radius)', background: 'var(--danger)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none' },
  list: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' },
  item: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 },
  itemName: { fontWeight: 700 },
  itemSub: { fontSize: 11, color: 'var(--text2)' },
  delBtn: { padding: '4px 10px', borderRadius: 4, background: 'var(--danger)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none' },
  backBtn: { padding: '6px 14px', borderRadius: 'var(--radius)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' },
}

export default function Admin() {
  const nav = useNavigate()
  const [data, setData] = useState({ rooms: [], tables: [], categories: [], items: [], users: [], settings: {} })
  const [ipTesting, setIpTesting] = useState(false)
  const [form, setForm] = useState({
    serverIp: '',
    roomName: '', roomIcon: '🍽️',
    tableRoom: '', tableNo: '', tableCaption: '',
    catName: '',
    itemCat: '', itemName: '', itemPrice: '', itemUnit: 'Plate',
    uname: '', upass: '', uDisplay: '', urole: 'cashier',
    stgCmp: '', stgAddr: '', stgGst: '', stgF1: '', stgF2: '',
  })

  async function load() {
    try {
      const [rm, tb, cats, itms, usrs, stg] = await Promise.all([
        api.getRooms(), api.getTables(), api.getCategories(),
        api.getItems(), api.getUsers(), api.getSettings()
      ])
      setData({ rooms: rm.data, tables: tb.data, categories: cats.data, items: itms.data, users: usrs.data, settings: stg.data })
      setForm(p => ({
        ...p, tableRoom: rm.data[0]?.id || '', itemCat: cats.data[0]?.id || '',
        stgCmp: stg.data.companyName || '', stgAddr: stg.data.address || '',
        stgGst: stg.data.gst || '', stgF1: stg.data.footer1 || '', stgF2: stg.data.footer2 || '',
      }))
    } catch (e) { toast('Load failed: ' + e.message, 'error') }
  }

  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // ── Change Server IP with connection test ─────────────────────────────────
  async function changeServerIp() {
    const ip = form.serverIp.trim()
    if (!ip) { toast('Enter an IP address', 'error'); return }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { toast('Enter a valid IP like 192.168.1.10', 'error'); return }

    setIpTesting(true)
    try {
      const res = await fetch(`http://${ip}:3001/api/rooms`, {
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) throw new Error()
      // ✅ Reachable — save and reload
      localStorage.setItem('posServerIp', ip)
      toast('✅ Server reachable! Reloading...', 'success')
      setTimeout(() => window.location.reload(), 1000)
    } catch {
      // ❌ Not reachable
      toast('❌ Cannot reach server at ' + ip + '. Check the IP and try again.', 'error')
    } finally {
      setIpTesting(false)
    }
  }

  // ── Reset IP — clears localStorage and goes back to IP setup screen ───────
  function resetServerIp() {
    localStorage.removeItem('posServerIp')
    toast('Server IP cleared — reloading...', 'info')
    setTimeout(() => window.location.reload(), 800)
  }

  async function addRoom() {
    if (!form.roomName) return
    try { await api.addRoom({ name: form.roomName.toUpperCase(), icon: form.roomIcon }); set('roomName', ''); load(); toast('Room added', 'success') }
    catch (e) { toast(e.message, 'error') }
  }

  async function addTable() {
    if (!form.tableNo || !form.tableCaption) return
    try { await api.addTable({ roomId: form.tableRoom, tableNo: form.tableNo, caption: form.tableCaption.toUpperCase() }); set('tableNo', ''); set('tableCaption', ''); load(); toast('Table added', 'success') }
    catch (e) { toast(e.message, 'error') }
  }

  async function addCategory() {
    if (!form.catName) return
    try { await api.addCategory({ name: form.catName.toUpperCase() }); set('catName', ''); load(); toast('Category added', 'success') }
    catch (e) { toast(e.message, 'error') }
  }

  async function addItem() {
    if (!form.itemName || !form.itemPrice) return
    try { await api.addItem({ catId: form.itemCat, name: form.itemName, price: form.itemPrice, unit: form.itemUnit }); set('itemName', ''); set('itemPrice', ''); load(); toast('Item added', 'success') }
    catch (e) { toast(e.message, 'error') }
  }

  async function addUser() {
    if (!form.uname || !form.upass || !form.uDisplay) return
    try { await api.addUser({ username: form.uname, password: form.upass, name: form.uDisplay, role: form.urole }); set('uname', ''); set('upass', ''); set('uDisplay', ''); load(); toast('User added', 'success') }
    catch (e) { toast(e.message, 'error') }
  }

  async function saveSettings() {
    try {
      await api.saveSettings({ companyName: form.stgCmp, address: form.stgAddr, gst: form.stgGst, footer1: form.stgF1, footer2: form.stgF2 })
      toast('Settings saved', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const inp = (k, ph, type = 'text', width = '') => (
    <input style={{ ...S.input, ...(width ? { maxWidth: width } : {}) }}
      type={type} placeholder={ph} value={form[k]} onChange={e => set(k, e.target.value)} />
  )

  return (
    <div style={S.screen}>
      <ToastContainer />
      <div style={S.header}>
        <button style={S.backBtn} onClick={() => nav('/dashboard')}>← BACK</button>
        <div style={S.logo}>SETUP</div>
      </div>
      <div style={S.body}>
        <div style={S.wrap}>

          {/* ── Server Connection ── */}
          <div style={S.section}>
            <div style={S.h2}>🌐 Server Connection</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
              Current IP:&nbsp;
              <strong style={{ color: 'var(--accent)', fontFamily: 'monospace', fontSize: 14 }}>
                {localStorage.getItem('posServerIp') || 'Not set'}
              </strong>
            </div>

            {/* Change IP row */}
            <div style={S.row}>
              <input
                style={S.input}
                type="text"
                placeholder="New Server IP (e.g. 192.168.1.10)"
                value={form.serverIp}
                onChange={e => set('serverIp', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !ipTesting && changeServerIp()}
              />
              <button
                style={{ ...S.saveBtn, opacity: ipTesting ? 0.6 : 1, cursor: ipTesting ? 'not-allowed' : 'pointer' }}
                onClick={changeServerIp}
                disabled={ipTesting}
              >
                {ipTesting ? '⏳ TESTING...' : '🔄 CHANGE IP'}
              </button>
            </div>

            {/* Reset IP row */}
            <div style={S.row}>
              <button style={S.dangerBtn} onClick={resetServerIp}>
                🗑️ RESET IP (Go to Setup Screen)
              </button>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
              ⚠️ CHANGE IP tests connection before saving. RESET IP clears saved IP and returns to setup screen.
            </div>
          </div>

          {/* ── Company Settings ── */}
          <div style={S.section}>
            <div style={S.h2}>🏪 Company Settings</div>
            <div style={S.row}>{inp('stgCmp', 'Company Name')}{inp('stgAddr', 'Address')}</div>
            <div style={S.row}>{inp('stgGst', 'GST Number')}{inp('stgF1', 'Footer Line 1')}{inp('stgF2', 'Footer Line 2')}</div>
            <div style={S.row}><button style={S.saveBtn} onClick={saveSettings}>💾 SAVE SETTINGS</button></div>
          </div>

          {/* ── Rooms ── */}
          <div style={S.section}>
            <div style={S.h2}>🚪 Room Types</div>
            <div style={S.row}>
              {inp('roomName', 'Room name (e.g. VIP)')}
              {inp('roomIcon', 'Icon', 'text', 80)}
              <button style={S.addBtn} onClick={addRoom}>+ ADD</button>
            </div>
            <div style={S.list}>
              {data.rooms.map(r => (
                <div key={r.id} style={S.item}>
                  <div><span style={S.itemName}>{r.icon} {r.name}</span></div>
                  <button style={S.delBtn} onClick={async () => { await api.deleteRoom(r.id); load() }}>DELETE</button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Tables ── */}
          <div style={S.section}>
            <div style={S.h2}>🪑 Tables</div>
            <div style={S.row}>
              <select style={S.select} value={form.tableRoom} onChange={e => set('tableRoom', e.target.value)}>
                {data.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {inp('tableNo', 'Table No', 'number', 90)}
              {inp('tableCaption', 'Caption (T15)')}
              <button style={S.addBtn} onClick={addTable}>+ ADD</button>
            </div>
            <div style={S.list}>
              {data.tables.map(t => (
                <div key={t.id} style={S.item}>
                  <div>
                    <span style={S.itemName}>{t.caption}</span>
                    <span style={S.itemSub}> — {data.rooms.find(r => r.id === t.room_id)?.name} — {t.status}</span>
                  </div>
                  <button style={S.delBtn} onClick={async () => { await api.deleteTable(t.id); load() }}>DEL</button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Categories ── */}
          <div style={S.section}>
            <div style={S.h2}>📂 Categories</div>
            <div style={S.row}>{inp('catName', 'Category name')}<button style={S.addBtn} onClick={addCategory}>+ ADD</button></div>
            <div style={S.list}>
              {data.categories.map(c => (
                <div key={c.id} style={S.item}>
                  <span style={S.itemName}>{c.name}</span>
                  <button style={S.delBtn} onClick={async () => { await api.deleteCategory(c.id); load() }}>DELETE</button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Menu Items ── */}
          <div style={S.section}>
            <div style={S.h2}>🍴 Menu Items</div>
            <div style={S.row}>
              <select style={S.select} value={form.itemCat} onChange={e => set('itemCat', e.target.value)}>
                {data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {inp('itemName', 'Item name')}
              {inp('itemPrice', 'Price', 'number', 90)}
              {inp('itemUnit', 'Unit', 'text', 80)}
              <button style={S.addBtn} onClick={addItem}>+ ADD</button>
            </div>
            <div style={S.list}>
              {data.items.map(i => (
                <div key={i.id} style={S.item}>
                  <div>
                    <span style={S.itemName}>{i.name}</span>
                    <span style={S.itemSub}> — {i.cat_name} — ₹{i.price} / {i.unit}</span>
                  </div>
                  <button style={S.delBtn} onClick={async () => { await api.deleteItem(i.id); load() }}>DEL</button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Users ── */}
          <div style={S.section}>
            <div style={S.h2}>👤 Users</div>
            <div style={S.row}>
              {inp('uname', 'Username')}
              <input style={S.input} type="password" placeholder="Password" value={form.upass} onChange={e => set('upass', e.target.value)} />
              {inp('uDisplay', 'Display Name')}
              <select style={S.select} value={form.urole} onChange={e => set('urole', e.target.value)}>
                <option value="cashier">Cashier</option>
                <option value="admin">Admin</option>
              </select>
              <button style={S.addBtn} onClick={addUser}>+ ADD</button>
            </div>
            <div style={S.list}>
              {data.users.map(u => (
                <div key={u.id} style={S.item}>
                  <div>
                    <span style={S.itemName}>{u.name}</span>
                    <span style={S.itemSub}> — @{u.username} — {u.role}</span>
                  </div>
                  <button style={S.delBtn} onClick={async () => { await api.deleteUser(u.id); load() }}>DEL</button>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}