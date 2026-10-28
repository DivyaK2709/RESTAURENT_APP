
import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import POS from './pages/POS'
import Admin from './pages/Admin'
import Reports from './pages/Reports'

function IpSetupScreen({ onDone }) {
  const [ip, setIp] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    const trimmed = ip.trim()
    if (!trimmed) { setError('Please enter the server IP'); return }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) { setError('Enter a valid IP like 192.168.1.10'); return }

    setLoading(true)
    setError('')

    try {
      const res = await fetch(`http://${trimmed}:3001/api/rooms`, {
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) throw new Error('Server responded with error')
      // ✅ Connection successful
      localStorage.setItem('posServerIp', trimmed)
      onDone()
    } catch (e) {
      // ❌ Cannot reach server
      setError('Cannot reach server at this IP. Check the IP and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0f',
      fontFamily: "'Orbitron', monospace",
    }}>
      <div style={{
        background: '#13131a',
        border: '1px solid #2a2a3a',
        borderRadius: 16,
        padding: '40px 36px',
        width: 340,
        textAlign: 'center',
        boxShadow: '0 0 40px rgba(0,200,255,0.08)',
      }}>
        <div style={{ fontSize: 22, color: '#00c8ff', letterSpacing: 4, marginBottom: 6, fontWeight: 800 }}>
          YNOT POS
        </div>
        <div style={{ fontSize: 11, color: '#555', letterSpacing: 2, marginBottom: 32 }}>
          POINT OF SALE SYSTEM
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          Enter the Server IP to connect
        </div>
        <input
          type="text"
          placeholder="e.g. 192.168.1.10"
          value={ip}
          onChange={e => { setIp(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && !loading && handleConnect()}
          autoFocus
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 8,
            fontSize: 16,
            background: '#1a1a2e',
            border: `1px solid ${error ? '#ff4444' : '#2a2a3a'}`,
            color: '#fff',
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: 10,
            fontFamily: 'monospace',
            letterSpacing: 2,
            textAlign: 'center',
          }}
        />
        {error && (
          <div style={{
            color: '#ff4444', fontSize: 11, marginBottom: 10,
            letterSpacing: 0.3, lineHeight: 1.5, padding: '6px 8px',
            background: 'rgba(255,68,68,0.08)', borderRadius: 6,
            border: '1px solid rgba(255,68,68,0.2)',
          }}>
            ❌ {error}
          </div>
        )}
        <button
          onClick={handleConnect}
          disabled={loading}
          style={{
            width: '100%',
            padding: '13px',
            borderRadius: 8,
            background: loading ? '#005a70' : '#00c8ff',
            color: loading ? '#aaa' : '#000',
            fontWeight: 800,
            fontSize: 13,
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            letterSpacing: 2,
            fontFamily: "'Orbitron', monospace",
            marginTop: 4,
            transition: 'background 0.2s',
          }}
        >
          {loading ? 'CONNECTING...' : 'CONNECT'}
        </button>
        {loading && (
          <div style={{ marginTop: 12, fontSize: 11, color: '#555' }}>
            Trying to reach server... (timeout 4s)
          </div>
        )}
        <div style={{ marginTop: 20, fontSize: 10, color: '#333', lineHeight: 1.6 }}>
          Ask your admin for the server IP address.<br />
          This is saved and remembered after first setup.
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [ipReady, setIpReady] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('posServerIp')
    if (saved && saved.trim()) setIpReady(true)
    setChecking(false)
  }, [])

  if (checking) return null

  if (!ipReady) {
    return (
      <IpSetupScreen
        onDone={() => window.location.reload()}
      />
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pos" element={<POS />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}