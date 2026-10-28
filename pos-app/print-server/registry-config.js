/**
 * registry-config.js
 * ------------------
 * Reads ALL YNOT POS configuration from the Windows Registry.
 * Registry key: HKEY_LOCAL_MACHINE\SOFTWARE\YNOT\POS
 *
 * Supports PRINTER1–PRINTER10 (network or USB)
 * PRINTER3 = Bill printer (USB, no colorIds)
 */

'use strict'
const { execSync } = require('child_process')

const REG_PATH = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\YNOT\\POS'

function readReg(name, fallback = '') {
  try {
    const out = execSync(
      `reg query "${REG_PATH}" /v "${name}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const match = out.match(new RegExp(`${name}\\s+REG_SZ\\s+(.+)`))
    if (match) return match[1].trim()
  } catch (_) {}
  console.warn(`[registry-config] WARNING: "${name}" not found → default: "${fallback}"`)
  return fallback
}

function parseIds(raw) {
  return String(raw).split(',')
    .map(x => Number(x.trim()))
    .filter(n => !isNaN(n) && n > 0)
}

function readNetworkPrinter(n, defaultIp, defaultColorIds) {
  return {
    ip:       readReg(`PRINTER${n}_IP`,       defaultIp),
    port:     parseInt(readReg(`PRINTER${n}_PORT`, '9100'), 10),
    colorIds: parseIds(readReg(`PRINTER${n}_COLORIDS`, defaultColorIds)),
  }
}

function readUSBPrinter(n, defaultName, defaultPort, defaultColorIds) {
  return {
    name:     readReg(`PRINTER${n}_NAME`, defaultName),
    port:     readReg(`PRINTER${n}_PORT`, defaultPort),
    colorIds: defaultColorIds
                ? parseIds(readReg(`PRINTER${n}_COLORIDS`, defaultColorIds))
                : [],
  }
}

function loadConfig() {
  const cfg = {
    // ── Database ─────────────────────────────────────────────────────────────
    db: {
      server:   readReg('DB_SERVER',   '192.168.29.175'),
      database: readReg('DB_NAME',     'ynot'),
      user:     readReg('DB_USER',     'sa'),
      password: readReg('DB_PASSWORD', '123'),
    },

    // ── Ports ─────────────────────────────────────────────────────────────────
    backendPort:     parseInt(readReg('BACKEND_PORT',      '3001'), 10),
    printServerPort: parseInt(readReg('PRINT_SERVER_PORT', '6543'), 10),

    // ── BILL_COUNTER_KOT — THE MISSING LINE (NOW FIXED) ──────────────────────
    billCounterKot:  readReg('BILL_COUNTER_KOT', '0') === '1',

    // ── PRINTER1 — Network KOT (colorId 1) ───────────────────────────────────
    printer1: readNetworkPrinter(1, '192.168.29.200', '1'),

    // ── PRINTER2 — USB KOT (colorId 2) ───────────────────────────────────────
    printer2: readUSBPrinter(2, 'POS-80', 'USB002', '2'),

    // ── PRINTER3 — USB Bill printer (no colorIds — bill only) ────────────────
    printer3: readUSBPrinter(3, 'POS-80C', 'USB018', ''),

    // ── PRINTER4 — Network KOT (colorId 3) ───────────────────────────────────
    printer4: readNetworkPrinter(4, '192.168.29.201', '3'),

    // ── PRINTER5 — Network KOT (colorId 4) ───────────────────────────────────
    printer5: readNetworkPrinter(5, '192.168.29.202', '4'),

    // ── PRINTER6–10 — Extra Network KOTs ─────────────────────────────────────
    printer6:  readNetworkPrinter(6,  '0.0.0.0', ''),
    printer7:  readNetworkPrinter(7,  '0.0.0.0', ''),
    printer8:  readNetworkPrinter(8,  '0.0.0.0', ''),
    printer9:  readNetworkPrinter(9,  '0.0.0.0', ''),
    printer10: readNetworkPrinter(10, '0.0.0.0', ''),
  }

  // ── Build printers array — only KOT printers (NOT PRINTER3 bill) ──────────
  cfg.printers = []

  // PRINTER1 — always include (network)
  cfg.printers.push({
    name:     'PRINTER1',
    type:     'network',
    ip:       cfg.printer1.ip,
    port:     cfg.printer1.port,
    colorIds: cfg.printer1.colorIds.length ? cfg.printer1.colorIds : [1],
  })

  // PRINTER2 — always include (USB)
  cfg.printers.push({
    name:     'PRINTER2',
    type:     'usb',
    usbName:  cfg.printer2.name,
    usbPort:  cfg.printer2.port,
    colorIds: cfg.printer2.colorIds.length ? cfg.printer2.colorIds : [2],
  })

  // PRINTER4–10 — include ONLY if colorIds are set in registry
  for (const n of [4, 5, 6, 7, 8, 9, 10]) {
    const p = cfg[`printer${n}`]
    if (p && p.colorIds && p.colorIds.length > 0 && p.ip !== '0.0.0.0') {
      cfg.printers.push({
        name:     `PRINTER${n}`,
        type:     'network',
        ip:       p.ip,
        port:     p.port,
        colorIds: p.colorIds,
      })
    }
  }

  // ── Console summary ───────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('║         YNOT POS  —  Registry Configuration          ║')
  console.log('╠══════════════════════════════════════════════════════╣')
  console.log(`║  DB       : ${(cfg.db.server + ' / ' + cfg.db.database).padEnd(40)}║`)
  console.log(`║  Backend  : port ${String(cfg.backendPort).padEnd(35)}║`)
  console.log(`║  PrintSrv : port ${String(cfg.printServerPort).padEnd(35)}║`)
  console.log('╠══════════════════════════════════════════════════════╣')
  console.log('║  KOT PRINTERS (active):                              ║')
  cfg.printers.forEach(p => {
    const info = p.type === 'network'
      ? `${p.ip}:${p.port}`
      : `${p.usbName}/${p.usbPort}`
    console.log(`║    ${(p.name + ' ' + p.type + ' colorIds:[' + p.colorIds + '] ' + info).padEnd(50)}║`)
  })
  console.log(`║  BILL     : ${(cfg.printer3.name + ' / ' + cfg.printer3.port).padEnd(40)}║`)
  console.log(`║  BILL_COUNTER_KOT : ${String(cfg.billCounterKot ? '1 (ON)' : '0 (OFF)').padEnd(32)}║`)
  console.log('╚══════════════════════════════════════════════════════╝\n')

  return cfg
}

module.exports = { loadConfig }