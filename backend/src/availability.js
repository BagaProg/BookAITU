// All intervals are half-open: an event ending at the requested start does not overlap.
function evaluate(room, events, start, end, booked = false) {
  const overlaps = events.filter(e => Date.parse(e.starts_at) < end && Date.parse(e.ends_at) > start);
  if (!room.is_active || room.student_access === false) return { availability: 'unavailable', reason: room.access_rules || 'Student access is not permitted' };
  const closure = overlaps.find(e => e.kind === 'closure');
  if (closure) return { availability: 'unavailable', reason: closure.title };
  const lesson = overlaps.find(e => e.kind === 'class');
  if (lesson || booked) return { availability: 'occupied', reason: lesson?.title || 'Reserved' };
  let coveredUntil = start;
  for (const event of overlaps.filter(e => e.kind === 'coverage').sort((a,b) => Date.parse(a.starts_at)-Date.parse(b.starts_at))) {
    if (Date.parse(event.starts_at) > coveredUntil) break;
    coveredUntil = Math.max(coveredUntil, Date.parse(event.ends_at));
  }
  return coveredUntil >= end ? { availability: 'available', reason: 'Complete timetable checked' } : { availability: 'unknown', reason: 'Timetable coverage is incomplete' };
}
async function inspect(db, room, date, start, end) {
  const from = `${date}T${start}+05:00`, to = `${date}T${end}+05:00`;
  const events = (await db.query('SELECT * FROM room_events WHERE room_id=$1 AND ends_at>$2::timestamptz ORDER BY starts_at', [room.id,from])).rows;
  const booked = (await db.query("SELECT id FROM bookings WHERE room_id=$1 AND booking_date=$2 AND status<>'cancelled' AND start_time<$4::time AND end_time>$3::time LIMIT 1", [room.id,date,start,end])).rowCount > 0;
  return { ...evaluate(room,events,Date.parse(from),Date.parse(to),booked), next_class: events.find(e=>e.kind==='class' && Date.parse(e.starts_at)>=Date.parse(from)) || null, schedule_updated_at: events.reduce((latest,e)=>!latest || Date.parse(e.updated_at)>Date.parse(latest)?e.updated_at:latest,null) };
}
module.exports = { evaluate, inspect };
