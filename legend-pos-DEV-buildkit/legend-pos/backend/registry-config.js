/**
 * registry-config.js
 * ------------------
 * Reads ALL YNOT POS configuration from the Windows Registry.
 * Registry key: HKEY_LOCAL_MACHINE\SOFTWARE\YNOT\POS
 *
 * Used by:  backend/index.js   (DB config, backend port)
 *           print-server/print-server.js  (printer IPs, ports, names)
 *
 * How it works:
 *   - Uses the built-in Windows `reg query` command (no extra npm package needed).
 *   - Falls back to sensible defaults so the server still starts even if a
 *     key is missing (makes debugging easier).
 *
 * To SET the registry values on this machine, double-click:
 *   1_setup-registry.reg
 */

'use strict'
const { execSync } = require('child_process')

const REG_PATH = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\YNOT\\POS'

// ── low-level helper ──────────────────────────────────────────────────────────

/**
 * Reads a single REG_SZ value from HKLM\SOFTWARE\YNOT\POS.
 * Returns the string value, or `fallback` if not found / error.
 */
function readReg(name, fallback = '') {
  try {
    // `reg query` output looks like:
    //   HKEY_LOCAL_MACHINE\SOFTWARE\YNOT\POS
    //       DB_SERVER    REG_SZ    192.168.29.243\YNOT
    const out = execSync(
      `reg query "${REG_PATH}" /v "${name}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    // parse the third token on the value line
    const match = out.match(new RegExp(`${name}\\s+REG_SZ\\s+(.+)`))
    if (match) return match[1].trim()
  } catch (_) {
    // key or value not found — fall through to default
  }
  console.warn(`[registry-config] WARNING: "${name}" not found in registry → using default: "${fallback}"`)
  return fallback
}

// ── exported config object ────────────────────────────────────────────────────

/**
 * Reads all config values at startup and returns a plain object.
 * Call this once at the top of each service.
 */
function loadConfig() {
  const cfg = {
    // SQL Server
    db: {
      server:   readReg('DB_SERVER',   '192.168.29.243\\YNOT'),
      database: readReg('DB_NAME',     'LEGEND'),
      user:     readReg('DB_USER',     'sa'),
      password: readReg('DB_PASSWORD', '123'),
    },

    // Node backend
    backendPort: parseInt(readReg('BACKEND_PORT', '3001'), 10),

    // Print server
    printServerPort: parseInt(readReg('PRINT_SERVER_PORT', '6543'), 10),

    // Printer 1 – Network thermal (food KOT + bill)
    printer1: {
      ip:   readReg('PRINTER1_IP',   '192.168.29.200'),
      port: parseInt(readReg('PRINTER1_PORT', '9100'), 10),
    },

    // Printer 2 – USB KOT printer
    printer2: {
      port: readReg('PRINTER2_PORT', 'USB016'),
      name: readReg('PRINTER2_NAME', 'POS-80'),
    },

    // Printer 3 – USB Bill printer
    printer3: {
      name: readReg('PRINTER3_NAME', 'POS-80C'),
      port: readReg('PRINTER3_PORT', 'USB018'),
    },
  }

  // ── print a summary to the console so you can verify at startup ──
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('║         YNOT POS  —  Registry Configuration          ║')
  console.log('╠══════════════════════════════════════════════════════╣')
  console.log(`║  DB Server  : ${cfg.db.server.padEnd(38)}║`)
  console.log(`║  DB Name    : ${cfg.db.database.padEnd(38)}║`)
  console.log(`║  Backend    : port ${String(cfg.backendPort).padEnd(34)}║`)
  console.log(`║  PrintSrv   : port ${String(cfg.printServerPort).padEnd(34)}║`)
  console.log(`║  Printer1   : ${(cfg.printer1.ip + ':' + cfg.printer1.port).padEnd(38)}║`)
  console.log(`║  Printer2   : ${(cfg.printer2.name + ' / ' + cfg.printer2.port).padEnd(38)}║`)
  console.log(`║  Printer3   : ${(cfg.printer3.name + ' / ' + cfg.printer3.port).padEnd(38)}║`)
  console.log('╚══════════════════════════════════════════════════════╝\n')

  return cfg
}

module.exports = { loadConfig }
