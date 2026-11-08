import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FirstFloor from './campus/C1_ALL_1'
import SecondFloor from './campus/C1_ALL_2'
import ThirdFloor from './campus/C1_ALL_3'
import './CampusMap.css'

const plans = { 1: FirstFloor, 2: SecondFloor, 3: ThirdFloor }
const labels = { available: 'Available', occupied: 'Occupied', unavailable: 'Unavailable', unknown: 'Unknown' }
export const mapCode = room => `${room.block}.${room.number}`.trim().toUpperCase()

export default function CampusMap({ rooms, slot, checkedAt, floorFilter = 'All', onFloorChange }) {
  const [floor, setFloor] = useState('1'), [selectedId, setSelectedId] = useState(null), [zoom, setZoom] = useState(1)
  const root = useRef(null), viewport = useRef(null)
  const displayedFloor = plans[String(floorFilter)] ? String(floorFilter) : floor
  const Plan = plans[displayedFloor]
  useEffect(() => { setSelectedId(null); setZoom(1); viewport.current?.scrollTo(0, 0) }, [displayedFloor])
  const selected = rooms.find(room => String(room.id) === selectedId && String(room.floor) === displayedFloor)
  useEffect(() => {
    const byCode = new Map(rooms.filter(room => String(room.floor) === displayedFloor).map(room => [mapCode(room), room]))
    root.current.querySelectorAll('g[data-name]').forEach(node => {
      const code = node.getAttribute('data-name').toUpperCase()
      if (!/^C1\.[123]\./.test(code)) return
      const room = byCode.get(code)
      const status = room?.availability || 'unknown'
      node.dataset.availability = status
      node.setAttribute('role', 'button')
      node.setAttribute('tabindex', '0')
      node.setAttribute('aria-label', `${code}: ${labels[status]}`)
      node.setAttribute('aria-pressed', String(Boolean(room && String(room.id) === selectedId)))
      if (room) node.dataset.roomId = String(room.id)
      else delete node.dataset.roomId
      let title = node.querySelector(':scope > title')
      if (!title) { title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); node.prepend(title) }
      title.textContent = `${code} · ${labels[status]}${room?.reason ? ` · ${room.reason}` : ''}`
    })
  }, [rooms, displayedFloor, selectedId])
  function choose(event) {
    const node = event.target.closest('g[data-availability]')
    if (!node) return
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return
    if (event.type === 'keydown') event.preventDefault()
    setSelectedId(node.dataset.roomId || null)
  }
  return <section className="campus-map" aria-labelledby="campus-map-heading">
    <div className="campus-map-toolbar"><div><h2 id="campus-map-heading">Campus map</h2><p>{slot.date} · {slot.start}–{slot.end} · Astana time</p></div>
      <div className="campus-map-floors" role="group" aria-label="Floor">{Object.keys(plans).map(value => <button type="button" key={value} aria-pressed={displayedFloor === value} onClick={() => { setFloor(value); onFloorChange?.(value); setSelectedId(null) }}>Floor {value}</button>)}</div>
      <div className="campus-map-zoom"><button type="button" aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom(v => Math.max(1, v - 0.5))}>−</button><button type="button" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="Zoom in" disabled={zoom === 3} onClick={() => setZoom(v => Math.min(3, v + 0.5))}>+</button></div>
    </div>
    <div className="campus-map-legend">{Object.entries(labels).map(([key, label]) => <span key={key}><i data-availability={key} />{label}</span>)}<span className="campus-map-toilet-legend"><i aria-hidden="true">♿</i> Toilets</span></div>
    <div className="campus-map-scroll" ref={viewport}><div ref={root} style={{ width: `${zoom * 100}%`, minWidth: `${zoom * 700}px` }} onClick={choose} onKeyDown={choose}><Plan /></div></div>
    {selected ? <div className="campus-map-detail" aria-live="polite"><strong>{selected.name || selected.code || mapCode(selected)} · {labels[selected.availability || 'unknown']}</strong><p>{selected.reason}</p><Link to={`/rooms/${selected.id}?${new URLSearchParams({ date: slot.date, start: slot.start, end: slot.end })}`}>View room & choose time →</Link></div> : <p>Select a room to see its status. Grey rooms have no matching inventory record.</p>}
    <small>Updated {new Date(checkedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Qyzylorda' })}. Refreshes every 15 seconds. Occupied includes reservations and known classes.</small>
    <p className="campus-map-credit">Floor plan by <a href="https://github.com/Yuujiso/aitumap" target="_blank" rel="noreferrer">Yuujiso / aitumap</a> · MIT License</p>
  </section>
}
