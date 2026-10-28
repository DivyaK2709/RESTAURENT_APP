export const fmt = (n) => Number(n || 0).toFixed(2)
export const pad = (n, l = 5) => String(n).padStart(l, '0')

export function center(str, w) {
  const s = String(str || '').substring(0, w)
  const p = Math.max(0, Math.floor((w - s.length) / 2))
  return ' '.repeat(p) + s
}
export const ljust = (str, w) => String(str || '').substring(0, w).padEnd(w, ' ')
export const rjust = (str, w) => String(str || '').substring(0, w).padStart(w, ' ')

export function buildReceipt(bill, settings) {
  const LINE = '─'.repeat(38)
  let r = ''
  r += center(settings?.companyName || 'RESTAURANT', 38) + '\n'
  r += center(settings?.address || '', 38) + '\n'
  if (settings?.gst) r += center('GST: ' + settings.gst, 38) + '\n'
  r += LINE + '\n'
  r += 'BILL# ' + bill.billNo + '   ' + bill.date + '  ' + bill.time + '\n'
  r += 'Type: ' + (bill.room || '') + '  Table: ' + (bill.table || '') + '\n'
  r += 'Cashier: ' + (bill.cashier || '') + '\n'
  r += LINE + '\n'
  r += ljust('ITEM', 22) + rjust('QTY', 5) + rjust('AMT', 11) + '\n'
  r += LINE + '\n'
  ;(bill.items || []).forEach(i => {
    r += ljust(i.name, 22) + rjust(i.qty, 5) + rjust('Rs.' + fmt(i.qty * i.rate), 11) + '\n'
    r += '  @ Rs.' + fmt(i.rate) + ' x ' + i.qty + '\n'
  })
  r += LINE + '\n'
  r += ljust('SUBTOTAL', 22) + rjust('Rs.' + fmt(bill.subtotal), 16) + '\n'
  if (bill.discount > 0) r += ljust('DISCOUNT', 22) + rjust('Rs.' + fmt(bill.discount), 16) + '\n'
  r += ljust('** TOTAL **', 22) + rjust('Rs.' + fmt(bill.total), 16) + '\n'
  r += ljust('PAY (' + (bill.payMode || 'CASH').toUpperCase() + ')', 22) + rjust('Rs.' + fmt(bill.amtReceived), 16) + '\n'
  if (bill.change > 0) r += ljust('CHANGE', 22) + rjust('Rs.' + fmt(bill.change), 16) + '\n'
  r += LINE + '\n'
  r += center('Items: ' + (bill.items || []).reduce((s, i) => s + i.qty, 0), 38) + '\n'
  r += LINE + '\n'
  r += center(settings?.footer1 || 'THANK YOU & VISIT AGAIN', 38) + '\n'
  if (settings?.footer2) r += center(settings.footer2, 38) + '\n'
  return r
}

export function buildKOT(billNo, table, room, cashier, newItems, settings) {
  const LINE = '--------------------------------'

  const ljust = (str, w) =>
    String(str || '').substring(0, w).padEnd(w, ' ')

  const rjust = (str, w) =>
    String(str || '').substring(0, w).padStart(w, ' ')

  let k = ''

  // HEADER
  k += 'TABLE : ' + (table || '') + '\n'
  k += 'BILL NO : ' + billNo + '\n'
  k += 'WAITER : ' + (cashier || '') + '\n'

  k += LINE + '\n'

  // COLUMN HEADER
  k += ljust('ITEM', 22)
  k += rjust('QTY', 5)
  k += rjust('UNIT', 8) + '\n'

  k += LINE + '\n'

  // ITEMS
  newItems.forEach(i => {
    k +=
      ljust(i.name, 22) +
      rjust(i.qty, 5) +
      rjust(i.unit || 'Plate', 8) +
      '\n'
  })

  k += LINE + '\n'

  // DATE & TIME
  const now = new Date()

  k +=
    now.toLocaleDateString('en-GB') +
    '   ' +
    now.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    }) +
    '\n'

  return k
}