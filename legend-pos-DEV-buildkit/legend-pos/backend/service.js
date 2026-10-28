const path = require('path')
const Service = require('node-windows').Service

// Resolves to <project-root>\backend\index.js automatically, wherever the
// project folder is placed on this machine. No need to edit this path.
const svc = new Service({
  name: 'YNOT POS Backend',
  description: 'Restaurant POS Backend Service',
  script: path.join(__dirname, 'index.js'),
})

svc.on('install', () => {
  console.log('✅ Service Installed')
  svc.start()
})

svc.on('start', () => {
  console.log('✅ Service Started')
})

svc.install()