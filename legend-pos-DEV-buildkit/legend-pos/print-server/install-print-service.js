// install-print-service.js
const path = require('path')
const Service = require('node-windows').Service

// Resolves to <project-root>\print-server\print-server.js automatically.
const svc = new Service({
  name: 'YNOT POS Print Server',
  description: 'Thermal Printer Service',
  script: path.join(__dirname, 'print-server.js'),
})

svc.on('install', () => {
  console.log('✅ Print Service Installed')
  svc.start()
})

svc.on('start', () => {
  console.log('✅ Print Service Started')
})

svc.install()