import { useState, useCallback, useRef } from 'react'

let toastFn = null
const S = {
  wrap: {
    position: 'fixed', bottom: 24, right: 16, zIndex: 9999,
    display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
  },
  box: (type) => ({
    background: type === 'error' ? '#1a0a0a' : type === 'success' ? '#0a1a0a' : '#0a131a',
    border: `1px solid ${type === 'error' ? '#ff3b3b' : type === 'success' ? '#00e676' : '#00e5ff'}`,
    color: type === 'error' ? '#ff3b3b' : type === 'success' ? '#00e676' : '#00e5ff',
    borderRadius: 8, padding: '10px 18px', fontSize: 14, fontFamily: 'var(--font)',
    fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  }),
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])
  toastFn = useCallback((msg, type = 'info') => {
    const id = Date.now()
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000)
  }, [])
  return (
    <div style={S.wrap}>
      {toasts.map(t => <div key={t.id} style={S.box(t.type)}>{t.msg}</div>)}
    </div>
  )
}

export const toast = (msg, type = 'info') => toastFn?.(msg, type)
