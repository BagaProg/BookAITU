import { useEffect, useRef, useState } from 'react'
import { MapPin, SlidersHorizontal, Search, Info } from 'lucide-react'
import { request } from '../api/client'
import { readSearchInterval, saveSearchInterval } from '../api/searchInterval'
import Layout from '../components/Layout'
import { Button, Container } from '../components/ui'
import { Segmented } from '../components/Fields'
import './Finder.css'
import { Select, DatePicker, TimePicker } from '../components/SearchPickers'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const typeName = room => room.room_type === 'room' ? (/P$/i.test(room.number || '') ? 'Practice Room' : 'Regular Classroom') : ({ hall: 'Assembly Hall', open_space: 'Open Space', coworking: 'Coworking' }[room.room_type] || room.room_type)
const statusNames = { available: 'Available', occupied: 'Occupied', unavailable: 'Temporarily unavailable', unknown: 'Unknown' }
const initial = () => ({ ...readSearchInterval(), block: 'All', floor: 'All', type: 'All' })
function RoomCard({ room, slot, checkedAt, index }) {
  const type = typeName(room), status = room.availability || 'unknown'
  const photo = ['cisco-lab', 'imac-lab', 'samsung-lab'][Number(BigInt(room.id) % 3n)]
  const query = new URLSearchParams({ date: slot.date, start: slot.start, end: slot.end })
  const target = `/rooms/${room.id}?${query}`
  const historical = slot.date < today()
  return <article className="finder-room">
    <div className="finder-photo"><img src={`/media/optimized/${photo}-800.webp`} srcSet={`/media/optimized/${photo}-480.webp 480w, /media/optimized/${photo}-800.webp ${photo === 'lecture-hall' ? 705 : 800}w`} sizes="(max-width: 767px) 100vw, 50vw" width="800" height="533" loading={index < 2 ? 'eager' : 'lazy'} alt="Example of an AITU learning space" /><span>AITU · illustrative photo</span></div>
    <div className="finder-room-body"><div className="finder-room-heading"><div><p>{type}</p><h3>{room.name || room.code}</h3></div><span className={`finder-badge ${status}`}>{statusNames[status]}</span></div>
      <dl><div><dt>Block</dt><dd>{room.block || '—'}</dd></div><div><dt>Floor</dt><dd>{room.floor ?? '—'}</dd></div><div className="finder-wide"><dt>Next scheduled class</dt><dd>Schedule not connected</dd></div><div><dt>Capacity</dt><dd>{room.capacity ?? 'Not provided'}</dd></div><div><dt>Last updated</dt><dd>{new Date(checkedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Qyzylorda', hour: '2-digit', minute: '2-digit' })} · Astana</dd></div></dl>
      <div className="finder-room-actions"><Button to={target} variant="secondary">View details</Button>{status === 'available' && !historical ? <Button to={target}>Book room</Button> : <Button variant="disabled">{historical ? 'Past date' : status === 'occupied' ? 'Already booked' : 'Booking not allowed'}</Button>}</div>
    </div>
  </article>
}
export default function Finder() {
  const [draft, setDraft] = useState(initial), [selection, setSelection] = useState(initial)
  const [filters, setFilters] = useState({ availability: 'All', block: 'All', floor: 'All', type: 'All' })
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0), [limit, setLimit] = useState(12)
  const results = useRef(null)
  useEffect(() => {
    let active = true
    const params = new URLSearchParams({ date: selection.date, start: selection.start, end: selection.end })
    request(`/api/rooms/availability?${params}`).then(value => { if (active) { setData(value); setError('') } }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selection, revision])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setRevision(v => v + 1) }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60000)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer) }
  }, [])
  const rooms = data?.rooms || []
  const blocks = ['All', ...new Set(rooms.map(r => r.block).filter(Boolean))]
  const floors = ['All', ...[...new Set(rooms.map(r => String(r.floor)).filter(v => v !== 'null'))].sort()]
  const types = ['All', ...new Set(rooms.map(typeName))]
  const set = key => value => setDraft(old => ({ ...old, [key]: value }))
  const filter = key => value => { setFilters(old => ({ ...old, [key]: value })); setLimit(12) }
  const matching = rooms.filter(room => (filters.block === 'All' || room.block === filters.block) && (filters.floor === 'All' || String(room.floor) === filters.floor) && (filters.type === 'All' || typeName(room) === filters.type))
  const visible = matching.filter(room => filters.availability === 'All' || statusNames[room.availability || 'unknown'] === filters.availability)
  function search(event) {
    event.preventDefault()
    if (!draft.date || !draft.start || !draft.end || draft.start >= draft.end) { setError('Choose a date and an end time after the start.'); return }
    saveSearchInterval(draft); setError(''); setLoading(true); setSelection({ ...draft }); setFilters({ availability: 'Available', block: draft.block, floor: draft.floor, type: draft.type }); setLimit(12)
    results.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const summary = [ ['Matching rooms', matching.length, 'Rooms matching your location and type filters'], ...Object.entries(statusNames).map(([status, label]) => [label, matching.filter(r => (r.availability || 'unknown') === status).length, ({ available: 'No overlapping reservations for the selected time', occupied: 'Reserved during the selected time', unavailable: 'Rooms disabled for new bookings', unknown: 'Availability has not been determined' })[status]]) ]
  return <Layout><Container className="finder-page"><header className="finder-hero"><p><MapPin size={16} />Your campus. Your space to focus.</p><h1>Find Your Perfect Study Space</h1><span>Find classrooms at AITU for studying, group projects, and quiet work.</span></header>
    <form className="finder-search" onSubmit={search}><div className="finder-search-title"><h2><SlidersHorizontal size={23} />Find a classroom</h2><span>Astana IT University</span></div><div className="finder-search-grid">
      <Segmented label="Block" options={blocks} value={draft.block} onChange={set('block')} />
      <Select label="Floor" format={v => v === 'All' ? 'All floors' : `Floor ${v}`} options={floors} value={draft.floor} onChange={set('floor')} />
      <DatePicker value={draft.date} onChange={set('date')} />
      <TimePicker label="Start time" value={draft.start} onChange={set('start')} />
      <TimePicker label="End time" value={draft.end} onChange={set('end')} />
      <Select label="Room type" options={types} value={draft.type} onChange={set('type')} />
    </div><div className="finder-search-bottom"><p><Info size={20} />Choose a time to see rooms that fit your schedule.</p><Button type="submit" disabled={loading}><Search size={22} />{loading ? 'Checking rooms…' : 'Find Available Rooms'}</Button></div></form>
    <section ref={results} className="finder-results"><div className="finder-section-title"><div><h2>Availability summary</h2><p>{selection.date} · {selection.start}–{selection.end} · Astana time</p></div><span>Live booking availability</span></div><p className="finder-note">Statuses apply only to the date and time above. Past dates can be searched but cannot be booked. University class schedules are not connected; availability is rechecked when you confirm.</p>
      {error && <div role="alert" className="auth-error">{error}<Button variant="secondary" onClick={() => { setLoading(true); setError(''); setRevision(v => v + 1) }}>Retry</Button></div>}
      {loading && <p role="status">Checking availability…</p>}
      {!loading && !error && data && <><div className="finder-summary">{summary.map(([label, value, description]) => <article key={label}><p>{label}</p><strong>{value}</strong><span>{description}</span></article>)}</div>
        <div className="finder-section-title"><h2>Matching rooms</h2><p>Showing {Math.min(limit, visible.length)} of {visible.length} rooms</p></div>
        <div className="finder-filters"><Segmented label="Availability" options={['All', 'Available', 'Occupied']} value={filters.availability} onChange={filter('availability')} /><Segmented label="Block" options={blocks} value={filters.block} onChange={filter('block')} /><Segmented label="Floor" options={floors} value={filters.floor} onChange={filter('floor')} /><Select label="Room type" options={types} value={filters.type} onChange={filter('type')} /></div>
        {visible.length ? <div className="finder-cards">{visible.slice(0, limit).map((room, index) => <RoomCard key={room.id} room={room} slot={selection} checkedAt={data.checkedAt} index={index} />)}</div> : <div className="finder-empty"><Search size={30} /><h3>No matching rooms</h3><p>Change your filters or select another time.</p></div>}
        {visible.length > limit && <Button variant="secondary" onClick={() => setLimit(v => v + 12)}>Show more rooms</Button>}</>}
    </section>
  </Container></Layout>
}
