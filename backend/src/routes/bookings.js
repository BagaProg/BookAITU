const router = require('express').Router();
const pool = require('../db');
const { validId, validateBooking } = require('../bookingValidation');

const allowWrite = (req, res, next) => {
  if (process.env.PG_ALLOW_WRITE !== 'true') return res.status(403).json({ error: 'Database writes are disabled' });
  next();
};

// READ
router.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT b.id, u.email, COALESCE(r.name, r.code) AS room, r.block,
           to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
           b.start_time, b.end_time, b.purpose, b.status, b.cancellation_reason
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    JOIN rooms r ON r.id = b.room_id
    WHERE ($1::boolean OR b.user_id = $2)
    ORDER BY b.booking_date DESC, b.start_time
    LIMIT 50`, [req.user.role === 'admin', req.user.id]);
  res.json(rows);
});

// WRITE
router.post('/', allowWrite, async (req, res) => {
  const input = { ...req.body, user_id: req.user.id };
  const validationError = validateBooking(input);
  if (validationError) return res.status(400).json({ error: validationError });
  if (Date.parse(`${input.booking_date}T${input.start_time}+05:00`) <= Date.now()) return res.status(400).json({ error: 'Choose a future start time' });
  if (req.user.role !== 'admin' && (Date.parse(`2000-01-01T${input.end_time}Z`) - Date.parse(`2000-01-01T${input.start_time}Z`)) > 2 * 3600000) return res.status(400).json({ error: 'Student requests are limited to two hours' });
  const { user_id, room_id, booking_date, start_time, end_time, purpose } = input;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the room so concurrent API requests cannot both reserve the same slot.
    const room = await client.query('SELECT * FROM rooms WHERE id = $1 AND is_active FOR UPDATE', [room_id]);
    const user = await client.query('SELECT id FROM users WHERE id = $1 AND is_active FOR UPDATE', [user_id]);
    if (!room.rowCount || !user.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User or room not found' });
    }
    if (req.user.role !== 'admin') {
      const count = await client.query("SELECT count(*)::int AS count FROM bookings WHERE user_id=$1 AND status='pending' AND booking_date>=timezone('Asia/Qyzylorda',now())::date", [user_id]);
      if (count.rows[0].count >= 2) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'You may have at most two pending requests' }); }
    }
    const availability = await require('../availability').inspect(client, room.rows[0], booking_date, start_time, end_time);
    if (availability.availability !== 'available') { await client.query('ROLLBACK'); return res.status(409).json({ error: availability.reason }); }
    const overlap = await client.query(
      `SELECT id FROM bookings WHERE room_id = $1 AND booking_date = $2
       AND status = 'confirmed' AND start_time < $4 AND end_time > $3 LIMIT 1`,
      [room_id, booking_date, start_time, end_time]
    );
    if (overlap.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Room is already booked for this time' });
    }
    const { rows } = await client.query(
      `INSERT INTO bookings (user_id, room_id, booking_date, start_time, end_time, purpose, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [user_id, room_id, booking_date, start_time, end_time, purpose.trim(), req.user.role === 'admin' ? 'confirmed' : 'pending']
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (['23503', '23514', '22001', '22007', '22008', '22P02'].includes(e.code)) {
      return res.status(400).json({ error: 'Invalid booking data' });
    }
    throw e;
  } finally {
    client.release();
  }
});

// DELETE
router.delete('/:id', allowWrite, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid booking id' });
  if (req.user.role === 'admin') {
    await require('../admin/service').cancelBooking(req.user.id, req.params.id, 'Отмена администратором');
    return res.status(204).end();
  }
  const result = await pool.query("UPDATE bookings SET status = 'cancelled',cancelled_at=COALESCE(cancelled_at,now()),cancelled_by=COALESCE(cancelled_by,$2),cancellation_reason=COALESCE(cancellation_reason,'Отмена пользователем') WHERE id = $1 AND status IN ('pending','confirmed') AND (user_id = $2 OR $3::boolean) RETURNING id", [req.params.id, req.user.id, req.user.role === 'admin']);
  if (!result.rowCount) return res.status(404).json({ error: 'Booking not found' });
  res.status(204).end();
});

module.exports = router;
