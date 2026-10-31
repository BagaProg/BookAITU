import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { request } from './api/client'
import Layout from './components/Layout'
import PageShell from './components/PageShell'
import { Button, Panel, Notice, TwoColumn, Detail } from './components/ui'
import AdminPanel from './pages/AdminPanel'
import Finder from './pages/Finder'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const slotQuery = slot => new URLSearchParams(slot).toString()
const validSlot = slot => /^\d{4}-\d{2}-\d{2}$/.test(slot.date || '') && /^\d{2}:\d{2}$/.test(slot.start || '') && /^\d{2}:\d{2}$/.test(slot.end || '') && slot.date >= today() && slot.start < slot.end

function useRecords(path) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    request(path).then(value => { if (active) { setData(value); setError('') } }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [path, revision])
  return { data, error, reload: () => { setData(null); setError(''); setRevision(value => value + 1) } }
}
function LoadState({ data, error, reload }) {
  if (error) return <Panel><p role="alert">{error}</p><Button onClick={reload}>Try again</Button></Panel>
  if (!data) return <p role="status">Loading…</p>
  return null
}
function Field({ label, children }) { return <label className="flex flex-col gap-2 text-sm font-medium text-ink">{label}{children}</label> }
const inputClass = 'rounded-lg border border-line bg-white p-3 text-copy'
function RoomSummary({ room, slot }) {
  return <><h2 className="text-2xl font-semibold text-ink">{room.name || room.code}</h2><div className="grid grid-cols-2 gap-4"><Detail label="Block">{room.block || '—'}</Detail><Detail label="Floor">{room.floor ?? '—'}</Detail><Detail label="Room type">{room.room_type}</Detail><Detail label="Access rules">{room.access_rules || 'Not provided'}</Detail><Detail label="Capacity">{room.capacity ?? 'Not provided'}</Detail></div>{slot && <Detail label="Selected time">{slot.date} · {slot.start}–{slot.end} (Astana)</Detail>}</>
}
function RoomPage({ review = false }) {
  const { id } = useParams(), [query] = useSearchParams(), navigate = useNavigate()
  const records = useRecords('/api/rooms'), room = records.data?.find(item => String(item.id) === id)
  const slot = Object.fromEntries(['date', 'start', 'end'].map(key => [key, query.get(key) || '']))
  const [purpose, setPurpose] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (busy || !validSlot(slot)) return
    setBusy(true); setError('')
    try {
      const booking = await request('/api/bookings', { method: 'POST', body: JSON.stringify({ room_id: id, booking_date: slot.date, start_time: slot.start, end_time: slot.end, purpose: purpose.trim() }) })
      navigate(`/bookings?created=${encodeURIComponent(booking.id)}`, { replace: true })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <PageShell title={review ? 'Review and confirm booking' : 'Room details'} description="Review the room and selected time before booking."><LoadState {...records} />{records.data && !records.error && (!room ? <Panel>Room not found or no longer active.<Button to="/find">Find another room</Button></Panel> : <TwoColumn left={<Panel title="About this room"><RoomSummary room={room} slot={slot} /></Panel>} right={<Panel title={review ? 'Confirm your reservation' : 'Selected time'}>{!validSlot(slot) ? <><p role="alert">Select a valid date and time to continue.</p><Button to="/find">Change selection</Button></> : <><Notice title="Availability checked on confirmation">The server checks for overlapping reservations before saving your booking. Classes, closures and complete timetable coverage are checked. Unknown availability cannot be booked.</Notice>{review ? <form className="flex flex-col gap-4" onSubmit={submit}><Field label="Purpose"><textarea className={inputClass} required maxLength={500} value={purpose} onChange={event => setPurpose(event.target.value)} /></Field>{error && <p role="alert" className="text-red-700">{error}</p>}<Button type="submit" disabled={busy || !purpose.trim()}>{busy ? 'Saving…' : 'Confirm booking'}</Button></form> : <Button to={`/rooms/${id}/review?${slotQuery(slot)}`}>Book room</Button>}<Button to="/find" variant="secondary">Change room or time</Button></>}</Panel>} />)}</PageShell>
}
function Bookings({ user }) {
  const records = useRecords('/api/bookings'), [query] = useSearchParams()
  const [cancelling, setCancelling] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function cancel() {
    setBusy(true); setError('')
    try { await request(`/api/bookings/${cancelling}`, { method: 'DELETE' }); setCancelling(null); records.reload() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const rows = records.data?.filter(row => row.email === user.email) || []
  return <PageShell active="bookings" title="My bookings" description="Your latest reservations and cancellations.">{query.get('created') && <Notice title={`Booking #${query.get('created')} created`}>Your reservation has been saved.</Notice>}<Button onClick={records.reload} variant="secondary">Refresh</Button><LoadState {...records} />{error && <p role="alert">{error}</p>}{records.data && !records.error && <>{!rows.length && <Panel>No bookings found.</Panel>}{rows.map(booking => <Panel key={booking.id} title={`${booking.room} · #${booking.id}`}><p>{booking.booking_date} · {booking.start_time.slice(0,5)}–{booking.end_time.slice(0,5)}</p><p>{booking.purpose}</p><p>Status: {booking.status}</p>{booking.status !== 'cancelled' && (cancelling === booking.id ? <div className="flex flex-wrap gap-3"><span>Cancel this reservation?</span><Button variant="danger" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</Button><Button variant="secondary" disabled={busy} onClick={() => setCancelling(null)}>Keep booking</Button></div> : <Button variant="danger" disabled={busy} onClick={() => setCancelling(booking.id)}>Cancel booking</Button>)}</Panel>)}<p className="text-sm text-muted">The API returns the latest 50 reservations{user.role === 'admin' ? ' across all users; use the admin panel to search older bookings' : ''}.</p></>}</PageShell>
}
export default function BookingApp({ user }) {
  return <Routes><Route path="/find" element={<Finder />} /><Route path="/rooms/:id" element={<RoomPage />} /><Route path="/rooms/:id/review" element={<RoomPage review />} /><Route path="/bookings" element={<Bookings user={user} />} /><Route path="/admin" element={user.role === 'admin' ? <><Layout active="admin"><AdminPanel user={user} /></Layout></> : <Navigate to="/find" replace />} /><Route path="*" element={<Navigate to="/find" replace />} /></Routes>
}
