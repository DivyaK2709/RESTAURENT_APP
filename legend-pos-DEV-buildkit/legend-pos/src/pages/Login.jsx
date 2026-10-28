import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../store/api'
import { ToastContainer, toast } from '../components/Toast'

const S = {
  screen: { height: '100vh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(ellipse at 30% 70%,#0d1f2d,#0a0c10 70%)' },
  box: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '40px 36px', width: 340, boxShadow: '0 0 60px rgba(0,229,255,.08)' },
  logo: { fontFamily: "'Orbitron',sans-serif", fontSize: 22, color: 'var(--accent)', letterSpacing: 4, marginBottom: 4 },
  sub: { color: 'var(--text2)', fontSize: 13, marginBottom: 30 },
  label: { display: 'block', fontSize: 11, color: 'var(--text2)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  input: { width: '100%', padding: '12px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 15, marginBottom: 18, boxSizing: 'border-box' },
  btn: { width: '100%', padding: 14, background: 'var(--accent)', color: '#000', fontSize: 16, fontWeight: 700, borderRadius: 'var(--radius)', letterSpacing: 2, cursor: 'pointer', border: 'none' },
  hint: { marginTop: 18, fontSize: 12, color: 'var(--text2)', textAlign: 'center' },
  hintSpan: { color: 'var(--accent)', cursor: 'pointer' },
}

function IpModal({ onClose }) {
  const [ip, setIp] = useState(localStorage.getItem('posServerIp') || '')
  const [error, setError] = useState('')

  function save() {
    const trimmed = ip.trim()
    if (!trimmed) { setError('Please enter an IP'); return }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) { setError('Enter a valid IP like 192.168.1.10'); return }
    localStorage.setItem('posServerIp', trimmed)
    toast('Server IP updated — reloading...', 'success')
    setTimeout(() => window.location.reload(), 800)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
      <div style={{ background: '#13131a', border: '1px solid #2a2a3a', borderRadius: 14, padding: '28px 28px', width: 300, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#00c8ff', letterSpacing: 2, marginBottom: 6, fontWeight: 700 }}>🌐 CHANGE SERVER IP</div>
        <div style={{ fontSize: 11, color: '#555', marginBottom: 20 }}>
          Current: <span style={{ color: '#00c8ff', fontFamily: 'monospace' }}>{localStorage.getItem('posServerIp') || 'Not set'}</span>
        </div>
        <input
          type="text"
          placeholder="e.g. 192.168.1.10"
          value={ip}
          onChange={e => { setIp(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && save()}
          autoFocus
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 15,
            background: '#1a1a2e', border: `1px solid ${error ? '#ff4444' : '#333'}`,
            color: '#fff', outline: 'none', boxSizing: 'border-box',
            fontFamily: 'monospace', letterSpacing: 2, textAlign: 'center', marginBottom: 8,
          }}
        />
        {error && <div style={{ color: '#ff4444', fontSize: 11, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'transparent', border: '1px solid #333', color: '#666', fontSize: 13, cursor: 'pointer' }}>CANCEL</button>
          <button onClick={save} style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#00c8ff', border: 'none', color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>SAVE</button>
        </div>
      </div>
    </div>
  )
}

export default function Login() {
  const nav = useNavigate()
  const [form, setForm] = useState({ username: 'admin', password: 'admin' })
  const [loading, setLoading] = useState(false)
  const [showIpModal, setShowIpModal] = useState(false)

  async function doLogin() {
    if (!form.username || !form.password) { toast('Enter username and password', 'error'); return }
    setLoading(true)
    try {
      const res = await login(form)
      sessionStorage.setItem('posUser', JSON.stringify(res.data.user))
      toast('Welcome, ' + res.data.user.name + '!', 'success')
      setTimeout(() => nav('/dashboard'), 400)
    } catch (e) {
      toast(e.response?.data?.error || 'Login failed. Check server connection.', 'error')
    }
    setLoading(false)
  }

  return (
    <div style={S.screen}>
      <ToastContainer />
      {showIpModal && <IpModal onClose={() => setShowIpModal(false)} />}
      <div style={S.box}>
        <div style={S.logo}>YNOT</div>
        <div style={S.sub}>Restaurant Management System</div>
        <label style={S.label}>Username</label>
        <input style={S.input} value={form.username}
          onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && doLogin()}
          placeholder="admin" />
        <label style={S.label}>Password</label>
        <input style={S.input} type="password" value={form.password}
          onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && doLogin()}
          placeholder="••••••" />
        <button style={S.btn} onClick={doLogin} disabled={loading}>
          {loading ? 'LOGGING IN...' : 'LOGIN →'}
        </button>
        <div style={S.hint}>
          Demo: <span style={S.hintSpan} onClick={() => setForm({ username: 'admin', password: 'admin' })}>admin / admin</span>
        </div>
        {/* Server IP row */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: '#444' }}>
            Server:&nbsp;
            <span style={{ color: '#00c8ff', fontFamily: 'monospace', fontSize: 12 }}>
              {localStorage.getItem('posServerIp') || 'Not set'}
            </span>
          </div>
          <button onClick={() => setShowIpModal(true)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: 'transparent', border: '1px solid #2a2a3a', color: '#00c8ff', cursor: 'pointer', letterSpacing: 1 }}>
            ⚙️ CHANGE IP
          </button>
        </div>
      </div>
    </div>
  )
}