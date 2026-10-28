import axios from 'axios'

const BACKEND_PORT = 3001

function resolveBaseUrl() {
  const saved = localStorage.getItem('posServerIp')
  if (saved && saved.trim()) {
    return `http://${saved.trim()}:${BACKEND_PORT}/api`
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host && host !== '' && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:${BACKEND_PORT}/api`
    }
  }
  // No hardcoded fallback — App.jsx ensures IP is always set before this runs
  console.warn('[api] No server IP found in localStorage')
  return ''
}

const BASE_URL = resolveBaseUrl()
console.log('[api] BASE_URL =', BASE_URL)

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
})

export const login = (data) => api.post('/auth/login', data)
export const settleBill = (data) => api.post('/bills/settle', data)
export const getRooms = () => api.get('/rooms')
export const addRoom = (data) => api.post('/rooms', data)
export const deleteRoom = (id) => api.delete(`/rooms/${id}`)
export const getTables = (roomId) => api.get('/tables', { params: { roomId } })
export const addTable = (data) => api.post('/tables', data)
export const updateTableStatus = (id, status) => api.put(`/tables/${id}/status`, { status })
export const deleteTable = (id) => api.delete(`/tables/${id}`)
export const getCategories = () => api.get('/categories')
export const addCategory = (data) => api.post('/categories', data)
export const deleteCategory = (id) => api.delete(`/categories/${id}`)
export const getItems = (catId) => api.get('/items', { params: catId ? { catId } : {} })
export const addItem = (data) => api.post('/items', data)
export const deleteItem = (id) => api.delete(`/items/${id}`)
export const getBills = () => api.get('/bills')
export const getBill = (billNo) => api.get(`/bills/${billNo}`)
export const saveBill = (data) => api.post('/bills', data)
export const holdBill = (data) => api.post('/bills/hold', data)
export const getHeldBill = (tableId) => api.get(`/bills/held/${tableId}`)
export const getBillCounter = () => api.get('/bill-counter')
export const nextBillCounter = () => api.post('/bill-counter/next')
export const saveKOT = (data) => api.post('/kot', data)
export const getUsers = () => api.get('/users')
export const addUser = (data) => api.post('/users', data)
export const deleteUser = (id) => api.delete(`/users/${id}`)
export const getSettings = () => api.get('/settings')
export const saveSettings = (data) => api.post('/settings', data)
export const getReportSummary = () => api.get('/reports/summary')

export default api