const Service = require('node-windows').Service

const svc = new Service({
  name: 'YNOT POS Backend',
  description: 'Restaurant POS Backend Service',
  script: 'C:\\legend-pos-v5-ynot\\pos-app\\backend\\index.js',
})

svc.on('install', () => {
  console.log('✅ Service Installed')
  svc.start()
})

svc.on('start', () => {
  console.log('✅ Service Started')
})

svc.install()