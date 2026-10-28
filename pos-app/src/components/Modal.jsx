const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px 20px', width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.7)' },
  h2: { fontSize: 18, fontWeight: 700, color: 'var(--accent)', marginBottom: 18 },
  label: { display: 'block', fontSize: 11, color: 'var(--text2)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 },
  input: { width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 14, marginBottom: 12 },
  select: { width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 14, marginBottom: 12 },
  btns: { display: 'flex', gap: 8, marginTop: 6 },
  ok: { flex: 1, padding: 11, borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#000', fontSize: 14, fontWeight: 700 },
  cancel: { flex: 1, padding: 11, borderRadius: 'var(--radius)', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14 },
}

export default function Modal({ open, onClose, title, onOk, okLabel = 'OK', children }) {
  if (!open) return null
  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.box}>
        <div style={S.h2}>{title}</div>
        {children}
        <div style={S.btns}>
          <button style={S.ok} onClick={onOk}>{okLabel}</button>
          <button style={S.cancel} onClick={onClose}>CANCEL</button>
        </div>
      </div>
    </div>
  )
}

export { S as modalStyle }
