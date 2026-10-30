const router = require('express').Router();
const pool = require('../db');
const { validId } = require('../bookingValidation');
const service = require('../admin/service');
const invalid = message => { throw service.fail(400, message); };
const pageOptions = query => {
  const value = (name, fallback, max) => { const text = query[name] ?? String(fallback); if (typeof text !== 'string' || !/^[1-9]\d{0,5}$/.test(text) || Number(text) > max) invalid(`Invalid ${name}`); return Number(text); };
  const page = value('page', 1, 100000), limit = value('limit', 25, 100);
  const q = query.q ?? ''; if (typeof q !== 'string' || q.length > 100) invalid('Search must be at most 100 characters');
  return { page, limit, offset: (page - 1) * limit, q: q.trim() };
};
const active = value => { if (value == null || value === '') return null; if (!['true', 'false'].includes(value)) invalid('Invalid active filter'); return value === 'true'; };
const validDate = text => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && text >= '0001-01-01'
  && Number.isFinite(new Date(`${text}T00:00:00Z`).getTime()) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
const body = (input, fields) => { if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key => !fields.includes(key))) invalid('Unsupported or empty update'); };
const paged = async (res, options, sql, params) => {
  // Same snapshot for rows and total, including empty pages.
  const result = await pool.query(`WITH filtered AS (${sql}), page_rows AS (SELECT * FROM filtered ORDER BY id::bigint DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2})
    SELECT (SELECT count(*)::int FROM filtered) AS total, COALESCE((SELECT json_agg(page_rows) FROM page_rows),'[]'::json) AS items`, [...params, options.limit, options.offset]);
  res.json({ ...result.rows[0], page: options.page, limit: options.limit });
};

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/dashboard', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const metrics = (await client.query(`SELECT to_char(timezone('Asia/Qyzylorda',now()),'YYYY-MM-DD') AS today,
      (SELECT count(*)::int FROM users) AS users_total,(SELECT count(*)::int FROM users WHERE is_active) AS users_active,
      (SELECT count(*)::int FROM users WHERE role='admin' AND is_active) AS admins_active,
      (SELECT count(*)::int FROM rooms) AS rooms_total,(SELECT count(*)::int FROM rooms WHERE is_active) AS rooms_active,
      (SELECT count(*)::int FROM bookings) AS bookings_total,
      (SELECT count(*)::int FROM bookings WHERE status<>'cancelled') AS bookings_active,
      (SELECT count(*)::int FROM bookings WHERE status='cancelled') AS bookings_cancelled,
      (SELECT count(*)::int FROM bookings WHERE booking_date=timezone('Asia/Qyzylorda',now())::date AND status<>'cancelled') AS bookings_today`)).rows[0];
    const upcoming = (await client.query(`SELECT to_char(d,'YYYY-MM-DD') AS date,count(b.id)::int AS count
      FROM generate_series(timezone('Asia/Qyzylorda',now())::date,timezone('Asia/Qyzylorda',now())::date+6,interval '1 day') d
      LEFT JOIN bookings b ON b.booking_date=d::date AND b.status<>'cancelled' GROUP BY d ORDER BY d`)).rows;
    const byStatus = (await client.query('SELECT status,count(*)::int AS count FROM bookings GROUP BY status ORDER BY status')).rows;
    await client.query('COMMIT'); res.json({ metrics, upcoming, byStatus, timezone: 'Asia/Qyzylorda' });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
});
router.get('/users', async (req, res) => {
  const options = pageOptions(req.query), enabled = active(req.query.active), role = req.query.role || null;
  if (role && !['user', 'admin'].includes(role)) invalid('Invalid role');
  await paged(res, options, `SELECT id::text AS id,email,name,role,is_active,two_factor_enabled,microsoft_id IS NOT NULL AS microsoft_linked,created_at,last_login_at
    FROM users WHERE ($1='' OR email ILIKE '%'||$1||'%' OR name ILIKE '%'||$1||'%') AND ($2::boolean IS NULL OR is_active=$2) AND ($3::text IS NULL OR role=$3)`, [options.q, enabled, role]);
});
router.get('/rooms', async (req, res) => {
  const options = pageOptions(req.query), enabled = active(req.query.active), block = req.query.block || null;
  if (block && !['C1.1', 'C1.2', 'C1.3'].includes(block)) invalid('Invalid block');
  await paged(res, options, `SELECT id::text AS id,code,name,block,floor,number,room_type,capacity,is_active FROM rooms
    WHERE ($1='' OR code ILIKE '%'||$1||'%' OR name ILIKE '%'||$1||'%') AND ($2::boolean IS NULL OR is_active=$2) AND ($3::text IS NULL OR block=$3)`, [options.q, enabled, block]);
});
router.get('/bookings', async (req, res) => {
  const options = pageOptions(req.query), status = req.query.status || null, room = req.query.room_id || null;
  const from = req.query.from || null, to = req.query.to || null;
  if (status && !['confirmed', 'cancelled'].includes(status)) invalid('Invalid status');
  if (room && !validId(room)) invalid('Invalid room_id');
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) invalid('Invalid date interval');
  await paged(res, options, `SELECT b.id::text AS id,b.user_id::text AS user_id,b.room_id::text AS room_id,u.email,r.code AS room_code,
    to_char(b.booking_date,'YYYY-MM-DD') AS booking_date,b.start_time,b.end_time,b.purpose,b.status,b.cancelled_at,b.cancellation_reason
    FROM bookings b JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id
    WHERE ($1='' OR u.email ILIKE '%'||$1||'%' OR r.code ILIKE '%'||$1||'%' OR b.purpose ILIKE '%'||$1||'%')
    AND ($2::text IS NULL OR b.status=$2) AND ($3::bigint IS NULL OR b.room_id=$3)
    AND ($4::date IS NULL OR b.booking_date >= $4) AND ($5::date IS NULL OR b.booking_date <= $5)`, [options.q, status, room, from, to]);
});
router.get('/audit', async (req, res) => {
  const options = pageOptions(req.query);
  await paged(res, options, `SELECT id::text AS id,actor_id::text AS actor_id,actor_email,action,resource_type,resource_id::text AS resource_id,before_data,after_data,created_at
    FROM admin_audit_log WHERE ($1='' OR actor_email ILIKE '%'||$1||'%' OR action ILIKE '%'||$1||'%')`, [options.q]);
});
router.use((req, res, next) => process.env.PG_ALLOW_WRITE === 'true' ? next() : res.status(403).json({ error: 'Database writes are disabled' }));
router.param('id', (req, res, next, id) => validId(id) ? next() : res.status(400).json({ error: 'Invalid id' }));
router.patch('/users/:id', async (req, res) => {
  body(req.body, ['role', 'is_active']);
  if (Object.hasOwn(req.body, 'role') && !['user', 'admin'].includes(req.body.role)) invalid('Invalid role');
  if (Object.hasOwn(req.body, 'is_active') && typeof req.body.is_active !== 'boolean') invalid('is_active must be boolean');
  res.json(await service.updateUser(req.user.id, req.params.id, req.body));
});
router.patch('/rooms/:id', async (req, res) => {
  body(req.body, ['name', 'capacity', 'is_active']); const input = { ...req.body };
  if (Object.hasOwn(input, 'name') && input.name !== null) { if (typeof input.name !== 'string' || input.name.trim().length > 100) invalid('Invalid name'); input.name = input.name.trim() || null; }
  if (Object.hasOwn(input, 'capacity') && input.capacity !== null && (!Number.isInteger(input.capacity) || input.capacity <= 0 || input.capacity > 2147483647)) invalid('Capacity must be a positive integer or null');
  if (Object.hasOwn(input, 'is_active') && typeof input.is_active !== 'boolean') invalid('is_active must be boolean');
  res.json(await service.updateRoom(req.user.id, req.params.id, input));
});
router.post('/bookings/:id/cancel', async (req, res) => {
  body(req.body, ['reason']); const reason = req.body.reason;
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) invalid('Cancellation reason must be 3–500 characters');
  res.json(await service.cancelBooking(req.user.id, req.params.id, reason.trim()));
});
module.exports = router;
