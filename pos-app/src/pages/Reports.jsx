import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ToastContainer, toast } from '../components/Toast'
import { fmt } from '../utils/helpers'
import * as api from '../store/api'

const S = {
  screen: { height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  header: { background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 16px', height: 50, display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 },
  logo: { fontFamily: "'Orbitron',sans-serif", fontSize: 14, color: 'var(--accent)', letterSpacing: 2 },
  backBtn: { padding: '6px 14px', borderRadius: 'var(--radius)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' },
  refreshBtn: { marginLeft: 'auto', padding: '6px 14px', borderRadius: 'var(--radius)', background: 'var(--accent2)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  body: { flex: 1, overflowY: 'auto', padding: 16 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 12, marginBottom: 20 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 },
  cardTitle: { fontSize: 11, color: 'var(--text2)', letterSpacing: .5, textTransform: 'uppercase' },
  cardVal: (color) => ({ fontSize: 26, fontFamily: 'var(--mono)', fontWeight: 700, marginTop: 6, color }),
  table: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 },
  th: { background: 'var(--surface3)', padding: '9px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text2)', letterSpacing: .5, textTransform: 'uppercase', whiteSpace: 'nowrap' },
  td: { padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, whiteSpace: 'nowrap' },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 12, letterSpacing: 1 },
  tag: (mode) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
    background: mode === 'cash' ? 'rgba(0,230,118,.15)' : mode === 'card' ? 'rgba(0,229,255,.12)' : 'rgba(255,107,53,.15)',
    color: mode === 'cash' ? 'var(--green)' : mode === 'card' ? 'var(--accent)' : 'var(--accent2)',
  }),
}

export default function Reports() {
  const nav = useNavigate()
  const [summary, setSummary] = useState(null)
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [sumRes, billsRes] = await Promise.all([api.getReportSummary(), api.getBills()])
      setSummary(sumRes.data)
      setBills(billsRes.data)
    } catch (e) { toast('Load failed: ' + (e.response?.data?.error || e.message), 'error') }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div style={S.screen}>
      <ToastContainer />
      <div style={S.header}>
        <button style={S.backBtn} onClick={() => nav('/dashboard')}>← BACK</button>
        <div style={S.logo}>REPORTS</div>
        <button style={S.refreshBtn} onClick={load}>{loading ? '...' : '⟳ REFRESH'}</button>
      </div>
      <div style={S.body}>

        {/* Summary Cards */}
        <div style={S.cards}>
          <div style={S.card}>
            <div style={S.cardTitle}>Today Bills</div>
            <div style={S.cardVal('var(--accent)')}>{summary?.today?.cnt || 0}</div>
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Today Revenue</div>
            <div style={S.cardVal('var(--green)')}>₹{fmt(summary?.today?.revenue)}</div>
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Total Bills</div>
            <div style={S.cardVal('var(--accent)')}>{summary?.overall?.cnt || 0}</div>
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Total Revenue</div>
            <div style={S.cardVal('var(--gold)')}>₹{fmt(summary?.overall?.revenue)}</div>
          </div>
        </div>

        {/* Payment mode breakdown */}
        {summary?.payModes?.length > 0 && (
          <>
            <div style={S.sectionTitle}>PAYMENT MODES</div>
            <div style={S.cards}>
              {summary.payModes.map(p => (
                <div key={p.pay_mode} style={S.card}>
                  <div style={S.cardTitle}>{p.pay_mode?.toUpperCase()}</div>
                  <div style={S.cardVal('var(--gold)')}>₹{fmt(p.revenue)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{p.cnt} bills</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Top Items */}
        {summary?.topItems?.length > 0 && (
          <>
            <div style={S.sectionTitle}>TOP SELLING ITEMS</div>
            <div style={S.table}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={S.th}>#</th>
                    <th style={S.th}>Item</th>
                    <th style={S.th}>Qty Sold</th>
                    <th style={S.th}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topItems.map((item, i) => (
                    <tr key={item.item_name}>
                      <td style={{ ...S.td, color: 'var(--text2)' }}>{i + 1}</td>
                      <td style={S.td}>{item.item_name}</td>
                      <td style={{ ...S.td, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{item.total_qty}</td>
                      <td style={{ ...S.td, fontFamily: 'var(--mono)', color: 'var(--gold)' }}>₹{fmt(item.total_amt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Bills list */}
        <div style={S.sectionTitle}>ALL BILLS</div>
        <div style={S.table}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={S.th}>Bill#</th>
                <th style={S.th}>Date</th>
                <th style={S.th}>Table</th>
                <th style={S.th}>Total</th>
                <th style={S.th}>Pay Mode</th>
                <th style={S.th}>Cashier</th>
                <th style={S.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.map(b => (
                <tr key={b.id} style={{ cursor: 'default' }}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', color: 'var(--gold)' }}>{b.bill_no}</td>
                  <td style={S.td}>{b.bill_date ? new Date(b.bill_date).toLocaleDateString('en-IN') : ''}</td>
                  <td style={S.td}>{b.room_name} / {b.table_caption}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', color: 'var(--green)' }}>₹{fmt(b.total)}</td>
                  <td style={S.td}><span style={S.tag(b.pay_mode)}>{(b.pay_mode || '').toUpperCase()}</span></td>
                  <td style={S.td}>{b.cashier_name}</td>
                  <td style={S.td}>
                    <span style={{ ...S.tag(b.status === 'saved' ? 'cash' : 'credit') }}>{b.status?.toUpperCase()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
