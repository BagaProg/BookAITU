export function readSearchInterval() {
  const fallback = {
    date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    start: '14:00', end: '16:00',
  }
  try {
    const value = JSON.parse(sessionStorage.getItem('bookaitu-search-interval'))
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && /^\d{2}:\d{2}$/.test(value.start) && /^\d{2}:\d{2}$/.test(value.end) && value.start < value.end) return value
  } catch { /* Storage can be disabled by browser settings. */ }
  return fallback
}

export function saveSearchInterval({ date, start, end }) {
  try { sessionStorage.setItem('bookaitu-search-interval', JSON.stringify({ date, start, end })) } catch { /* Search still works without storage. */ }
}
