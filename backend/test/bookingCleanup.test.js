const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanupExpiredBookings, startBookingCleanup } = require('../src/bookingCleanup');

function database(counts = [0], failure = false) {
  const calls = [];
  return { calls, async connect() {
    return { async query(sql) {
      calls.push(sql);
      if (sql.startsWith('WITH expired')) {
        if (failure) throw Object.assign(new Error('unavailable'), { code: 'TEST_ERROR' });
        return { rowCount: counts.shift() ?? 500 };
      }
      return {};
    }, release() { calls.push('RELEASE'); } };
  } };
}
const writable = { PG_ALLOW_WRITE: 'true' };
test('cleanup obeys write flag without connecting', async () => {
  const db = { connect() { throw new Error('Must not connect'); } };
  assert.equal(await cleanupExpiredBookings(db, {}), 0);
  assert.equal(await cleanupExpiredBookings(db, { PG_ALLOW_WRITE: 'false' }), 0);
});
test('cleanup uses university date, preserves today, bounds batches and skips locked rows', async () => {
  const db = database([500, 2]);
  assert.equal(await cleanupExpiredBookings(db, writable), 502);
  const sql = db.calls.find(sql => sql.startsWith('WITH expired'));
  assert.match(sql, /booking_date < timezone\('Asia\/Qyzylorda', now\(\)\)::date - 90/);
  assert.match(sql, /LIMIT 500\s+FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /DELETE FROM bookings b USING expired WHERE b.id = expired.id/);
  assert.equal(db.calls.filter(sql => sql === 'COMMIT').length, 2);
  assert.equal(db.calls.filter(sql => sql === 'RELEASE').length, 2);
  assert.ok(db.calls.includes("SET LOCAL statement_timeout = '5s'"));
});
test('large backlog is capped at 5000 deletions per run', async () => {
  const db = database([]);
  assert.equal(await cleanupExpiredBookings(db, writable), 5000);
  assert.equal(db.calls.filter(sql => sql === 'COMMIT').length, 10);
});
test('cleanup rolls back and releases connection on failure', async () => {
  const db = database([], true);
  await assert.rejects(cleanupExpiredBookings(db, writable));
  assert.ok(db.calls.includes('ROLLBACK'));
  assert.ok(!db.calls.includes('COMMIT'));
  assert.equal(db.calls.at(-1), 'RELEASE');
});
test('scheduler starts immediately, avoids overlap and retries after failure', async () => {
  let tick, interval, connections = 0, finish, stopped = false;
  const errors = [];
  const pool = { connect() { connections++; return new Promise((resolve, reject) => { finish = reject; }); } };
  const stop = startBookingCleanup(pool, { env: writable,
    schedule(fn, ms) { tick = fn; interval = ms; return { unref() {} }; },
    unschedule() { stopped = true; }, logger: { info() {}, error(...args) { errors.push(args); } },
  });
  assert.equal(connections, 1); assert.equal(interval, 3600000);
  await tick(); assert.equal(connections, 1);
  finish(new Error('test'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, 1);
  const retry = tick(); assert.equal(connections, 2);
  finish(new Error('test')); await retry;
  stop(); assert.equal(stopped, true);
});
