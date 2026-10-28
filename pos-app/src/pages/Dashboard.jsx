import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ToastContainer, toast } from '../components/Toast'

const cards = [
  { label: 'SALES', icon: '🏪', path: '/pos', color: '#00e5ff' },
  { label: 'REPORTS', icon: '📊', path: '/reports', color: '#ffd700' },
  { label: 'SETUP', icon: '⚙️', path: '/admin', color: '#ff6b35' },
]

const S = {
  screen: { height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  header: {
    background: 'var(--surface)', borderBottom: '1px solid var(--border)',
    padding: '0 20px', height: 54, display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', flexShrink: 0,
  },
  logo: { fontFamily: "'Orbitron',sans-serif", fontSize: 16, color: 'var(--accent)', letterSpacing: 3 },
  user: { fontSize: 13, color: 'var(--text2)' },
  body: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flexWrap: 'wrap', padding: 40 },
  card: (color) => ({
    width: 160, height: 150, background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 12, fontSize: 17, fontWeight: 700, letterSpacing: 1,
    cursor: 'pointer', color: 'var(--text)', transition: 'all .15s',
  }),
  icon: { fontSize: 38 },
  logout: {
    position: 'absolute', bottom: 24, right: 20,
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text2)', padding: '8px 16px',
    borderRadius: 'var(--radius)', fontSize: 13, cursor: 'pointer',
  },
}

// ── IP Change Modal ────────────────────────────────────────────────────────
function IpModal({ onClose }) {
  const [ip, setIp] = useState(localStorage.getItem('posServerIp') || '')
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)

  async function save() {
    const trimmed = ip.trim()
    if (!trimmed) { setError('Please enter an IP'); return }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) { setError('Enter a valid IP like 192.168.1.10'); return }

    setTesting(true)
    setError('')
    try {
      const res = await fetch(`http://${trimmed}:3001/api/rooms`, {
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) throw new Error()
      localStorage.setItem('posServerIp', trimmed)
      toast('✅ Server reachable! Reloading...', 'success')
      setTimeout(() => window.location.reload(), 800)
    } catch {
      setError('Cannot reach server at this IP. Check and try again.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }}>
      <div style={{
        background: '#13131a', border: '1px solid #2a2a3a', borderRadius: 14,
        padding: '28px 28px', width: 300, textAlign: 'center',
      }}>
        <div style={{ fontSize: 13, color: '#00c8ff', letterSpacing: 2, marginBottom: 6, fontWeight: 700 }}>
          🌐 CHANGE SERVER IP
        </div>
        <div style={{ fontSize: 11, color: '#555', marginBottom: 20 }}>
          Current:{' '}
          <span style={{ color: '#00c8ff', fontFamily: 'monospace' }}>
            {localStorage.getItem('posServerIp') || 'Not set'}
          </span>
        </div>
        <input
          type="text"
          placeholder="e.g. 192.168.1.10"
          value={ip}
          onChange={e => { setIp(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && !testing && save()}
          autoFocus
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 15,
            background: '#1a1a2e', border: `1px solid ${error ? '#ff4444' : '#333'}`,
            color: '#fff', outline: 'none', boxSizing: 'border-box',
            fontFamily: 'monospace', letterSpacing: 2, textAlign: 'center', marginBottom: 8,
          }}
        />
        {error && (
          <div style={{
            color: '#ff4444', fontSize: 11, marginBottom: 8,
            background: 'rgba(255,68,68,0.08)', borderRadius: 6,
            border: '1px solid rgba(255,68,68,0.2)', padding: '5px 8px',
          }}>
            ❌ {error}
          </div>
        )}
        {testing && (
          <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
            Connecting... (timeout 4s)
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px', borderRadius: 8,
              background: 'transparent', border: '1px solid #333',
              color: '#666', fontSize: 13, cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
          <button
            onClick={save}
            disabled={testing}
            style={{
              flex: 1, padding: '10px', borderRadius: 8,
              background: testing ? '#005a70' : '#00c8ff',
              border: 'none', color: testing ? '#aaa' : '#000',
              fontSize: 13, fontWeight: 800, cursor: testing ? 'not-allowed' : 'pointer',
            }}
          >
            {testing ? 'TESTING...' : 'SAVE & CONNECT'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────
export default function Dashboard() {
  const nav = useNavigate()
  const user = JSON.parse(sessionStorage.getItem('posUser') || '{}')
  const [showIpModal, setShowIpModal] = useState(false)

  return (
    <div style={{ ...S.screen, position: 'relative' }}>
      <ToastContainer />
      {showIpModal && <IpModal onClose={() => setShowIpModal(false)} />}

      {/* Header */}
      <div style={S.header}>
        <div style={S.logo}>YNOT</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* ── Server IP chip — click to change IP ── */}
          <button
            onClick={() => setShowIpModal(true)}
            title="Click to change server IP"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 20,
              background: 'transparent', border: '1px solid #2a2a3a',
              cursor: 'pointer', transition: 'border-color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#00c8ff'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2a3a'}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#22c55e', display: 'inline-block',
            }} />
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#00c8ff' }}>
              {localStorage.getItem('posServerIp') || 'No IP'}
            </span>
          </button>

          {/* User info */}
          <div style={S.user}>
            <span style={{ color: 'var(--accent2)', fontWeight: 700 }}>{user.name || 'User'}</span>
            &nbsp;·&nbsp;{user.role?.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Main cards */}
      <div style={S.body}>
        {cards.map(c => (
          <button
            key={c.path}
            style={S.card(c.color)}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = c.color
              e.currentTarget.style.color = c.color
              e.currentTarget.style.transform = 'translateY(-3px)'
              e.currentTarget.style.boxShadow = `0 8px 30px ${c.color}22`
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--text)'
              e.currentTarget.style.transform = ''
              e.currentTarget.style.boxShadow = ''
            }}
            onClick={() => nav(c.path)}
          >
            <div style={S.icon}>{c.icon}</div>
            {c.label}
          </button>
        ))}
      </div>

      <button
        style={S.logout}
        onClick={() => { sessionStorage.clear(); nav('/') }}
      >
        LOGOUT
      </button>
    </div>
  )
}