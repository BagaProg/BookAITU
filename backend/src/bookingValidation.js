const validId = value => ['string', 'number'].includes(typeof value)
  && (typeof value !== 'number' || Number.isSafeInteger(value))
  && /^[1-9]\d{0,18}$/.test(String(value)) && BigInt(value) <= 9223372036854775807n;
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);

function validateBooking(body) {
  if (!body || !validId(body.user_id) || !validId(body.room_id)) return 'Valid user_id and room_id are required';
  const { booking_date, start_time, end_time, purpose } = body;
  if (typeof booking_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(booking_date) || booking_date < '0001-01-01') return 'Invalid booking date';
  const date = new Date(`${booking_date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== booking_date) return 'Invalid booking date';
  if (!validTime(start_time) || !validTime(end_time)) return 'Invalid booking time';
  const seconds = value => value.length === 5 ? `${value}:00` : value;
  if (seconds(start_time) >= seconds(end_time)) return 'End time must be after start time';
  if (typeof purpose !== 'string' || !purpose.trim()) return 'Purpose is required';
  return null;
}

module.exports = { validId, validateBooking };
