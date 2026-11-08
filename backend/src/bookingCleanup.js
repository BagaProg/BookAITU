// Keep booking history for 90 days in the university timezone.
const cleanupSql = `WITH expired AS (
  SELECT id FROM bookings
  WHERE booking_date < timezone('Asia/Qyzylorda', now())::date - 90
  ORDER BY booking_date, id LIMIT 500
  FOR UPDATE SKIP LOCKED
)
DELETE FROM bookings b USING expired WHERE b.id = expired.id`;

async function cleanupExpiredBookings(pool, env = process.env) {
  if (env.PG_ALLOW_WRITE !== 'true') return 0;
  let deleted = 0;
  for (let batch = 0; batch < 10; batch++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("UPDATE bookings SET status='expired' WHERE status='pending' AND booking_date + start_time <= timezone('Asia/Qyzylorda',now())");
      const result = await client.query(cleanupSql);
      await client.query('COMMIT');
      deleted += result.rowCount;
      if (result.rowCount < 500) break;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  return deleted;
}

function startBookingCleanup(pool, { env = process.env, logger = console, schedule = setInterval, unschedule = clearInterval } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const count = await cleanupExpiredBookings(pool, env);
      if (count) logger.info(`Expired bookings removed: ${count}`);
    } catch (error) {
      // Maintenance failure must not take down booking/authentication requests.
      logger.error('Booking cleanup failed:', error.code || error.name);
    } finally { running = false; }
  };
  const timer = schedule(run, 60 * 60 * 1000);
  timer.unref?.();
  void run();
  return () => unschedule(timer);
}

module.exports = { cleanupExpiredBookings, startBookingCleanup };
