const router = require('express').Router();
const pool = require('../db');
const { validateBooking } = require('../bookingValidation');

// Only room availability is exposed; no other user's booking details or identity.
router.get('/availability', async (req, res) => {
  const { date, start, end } = req.query;
  const error = validateBooking({ user_id: '1', room_id: '1', booking_date: date, start_time: start, end_time: end, purpose: 'Availability' });
  if (error) return res.status(400).json({ error });
  const { rows } = await pool.query(`SELECT r.id, COALESCE(r.name, r.code) AS name,
    r.block, r.floor, r.number, r.code, r.room_type, r.capacity,
    CASE WHEN NOT r.is_active THEN 'unavailable'
      WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id
        AND b.booking_date = $1 AND b.status <> 'cancelled'
        AND b.start_time < $3::time AND b.end_time > $2::time)
      THEN 'occupied' ELSE 'available' END AS availability
    FROM rooms r ORDER BY r.block, r.floor, r.number`, [date, start, end]);
  res.set('Cache-Control', 'no-store');
  res.json({ rooms: rows, checkedAt: new Date().toISOString() });
});

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`SELECT id, COALESCE(name, code) AS name,
    block, floor, number, code, room_type, capacity
    FROM rooms WHERE is_active ORDER BY block, floor, number`);
  res.json(rows);
});

module.exports = router;
