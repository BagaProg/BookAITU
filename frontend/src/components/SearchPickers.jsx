import { useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react'

function Popup({ label, valueLabel, icon: Icon, children }) {
  const [open, setOpen] = useState(false), root = useRef(null), button = useRef(null), id = useId()
  useEffect(() => {
    if (!open) return
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false) }
    const escape = e => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const close = () => { setOpen(false); button.current?.focus() }
  return <div className="finder-field finder-picker" ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}><span id={`${id}-label`}>{label}</span><button ref={button} type="button" className="finder-picker-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{Icon && <Icon size={21} aria-hidden="true" />}<span id={`${id}-value`}>{valueLabel}</span><ChevronDown size={18} aria-hidden="true" /></button>{open && <div id={id} className="finder-picker-popup" role="group" aria-labelledby={`${id}-label`}>{children(close)}</div>}</div>
}
export function Select({ label, value, options, onChange, format = v => v, icon }) {
  return <Popup label={label} valueLabel={format(value)} icon={icon}>{close => <div className="finder-options">{options.map(option => <button key={option} type="button" aria-pressed={value === option} className={value === option ? 'selected' : ''} onClick={() => { onChange(option); close() }}>{format(option)}</button>)}</div>}</Popup>
}
export function TimePicker({ label, value, onChange }) {
  const hour = value.slice(0, 2), minute = value.slice(3, 5)
  return <Popup label={label} valueLabel={value} icon={Clock3}>{close => <><p className="finder-picker-caption">24-hour time · Astana</p><div className="finder-time-columns">{[['Hour', 24, hour, h => onChange(`${h}:${minute}`)], ['Minute', 60, minute, m => onChange(`${hour}:${m}`)]].map(([title, count, selected, change]) => <div key={title}><p>{title}</p><div className="finder-options">{Array.from({ length: count }, (_, i) => String(i).padStart(2, '0')).map(v => <button key={v} type="button" aria-pressed={v === selected} className={v === selected ? 'selected' : ''} onClick={() => change(v)}>{v}</button>)}</div></div>)}</div><button type="button" className="finder-picker-done" onClick={close}>Done</button></>}</Popup>
}
const iso = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
export function DatePicker({ value, onChange }) {
  const [month, setMonth] = useState(() => new Date(`${value}T12:00:00`))
  const year = month.getFullYear(), m = month.getMonth(), offset = (new Date(year, m, 1).getDay() + 6) % 7
  const count = new Date(year, m + 1, 0).getDate()
  return <Popup label="Date" valueLabel={new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} icon={CalendarDays}>{close => <><div className="finder-calendar-heading"><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(year, m - 1, 1))}><ChevronLeft size={20} /></button><strong>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</strong><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(year, m + 1, 1))}><ChevronRight size={20} /></button></div><div className="finder-calendar">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <span key={d}>{d}</span>)}{Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: count }, (_, i) => i + 1).map(day => <button key={day} type="button" aria-label={iso(year, m, day)} aria-pressed={value === iso(year, m, day)} className={value === iso(year, m, day) ? 'selected' : ''} onClick={() => { onChange(iso(year, m, day)); close() }}>{day}</button>)}</div></>}</Popup>
}
