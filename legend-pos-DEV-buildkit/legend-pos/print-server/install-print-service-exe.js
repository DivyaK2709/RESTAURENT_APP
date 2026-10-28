// install-print-service-exe.js
// ---------------------------------------------------------------------------
// Installs the COMPILED print server (ynot-pos-printserver.exe) as a
// Windows service. Use this on the CLIENT machine, where only the .exe is
// present (no source).
//
// Usage on the client machine:
//   1. Make sure ynot-pos-printserver.exe is in this same folder.
//   2. npm install node-windows   (one-time, needs internet)
//   3. node install-print-service-exe.js
// ---------------------------------------------------------------------------
const path = require('path')
const fs = require('fs')
const Service = require('node-windows').Service

const exePath = path.join(__dirname, 'ynot-pos-printserver.exe')

if (!fs.existsSync(exePath)) {
  console.error('❌ ynot-pos-printserver.exe not found in this folder.')
  console.error('   Expected at:', exePath)
  process.exit(1)
}

const svc = new Service({
  name: 'YNOT POS Print Server',
  description: 'Thermal Printer Service',
  script: exePath,
})

svc.on('install', () => {
  console.log('✅ Print Service Installed')
  svc.start()
})

svc.on('start', () => {
  console.log('✅ Print Service Started')
})

svc.install()
