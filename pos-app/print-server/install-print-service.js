// install-print-service.js

const Service = require('node-windows').Service

const svc = new Service({
  name: 'YNOT POS Print Server',
  description: 'Thermal Printer Service',
  script: 'C:\\legend-pos-v5-ynot\\pos-app\\print-server\\print-server.js',
})

svc.on('install', () => {
  console.log('✅ Print Service Installed')
  svc.start()
})

svc.on('start', () => {
  console.log('✅ Print Service Started')
})

svc.install()