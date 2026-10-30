const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { validateBooking } = require('../src/bookingValidation');
const pool = require('../src/db');
const { createApp } = require('../src/server');
const { authHarness, browser } = require('./helpers/authHarness');
const harness = authHarness();
const app = createApp({ auth: harness.options });

const valid = { user_id: '1', room_id: '1', booking_date: '2026-10-23', start_time: '10:00', end_time: '11:00', purpose: 'Study' };
let server, base, signedIn;
const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalWrite = process.env.PG_ALLOW_WRITE;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  signedIn = browser(base);
  await signedIn.login();
});
after(async () => {
  pool.query = originalQuery;
  pool.connect = originalConnect;
  if (originalWrite === undefined) delete process.env.PG_ALLOW_WRITE;
  else process.env.PG_ALLOW_WRITE = originalWrite;
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

test('validates dates, ids, time ranges and required purpose', () => {
  assert.equal(validateBooking(valid), null);
  assert.equal(validateBooking({ ...valid, room_id: '9223372036854775807' }), null);
  for (const body of [null, { ...valid, user_id: '1 OR 1=1' }, { ...valid, room_id: '9223372036854775808' },
    { ...valid, room_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, booking_date: '2026-02-30' }, { ...valid, start_time: '24:00' },
    { ...valid, end_time: '09:00' }, { ...valid, start_time: '10:00:00', end_time: '10:00' },
    { ...valid, purpose: ' ' }]) assert.ok(validateBooking(body));
});

const post = body => signedIn.request('/api/bookings', { method: 'POST', body: JSON.stringify(body) });

function mockTransaction({ missing = false, conflict = false, failure = false } = {}) {
  const calls = [];
  pool.connect = async () => ({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM rooms')) return { rowCount: missing ? 0 : 1 };
      if (sql.includes('FROM users')) return { rowCount: 1 };
      if (sql.includes('FROM bookings')) return { rowCount: conflict ? 1 : 0 };
      if (sql.includes('INSERT')) {
        assert.match(sql, /purpose, status/);
        assert.match(sql, /'confirmed'/);
        if (failure) throw Object.assign(new Error('private database details'), { code: 'XX000' });
        return { rows: [{ id: 123 }] };
      }
      return {};
    },
    release: () => calls.push({ sql: 'RELEASE' }),
  });
  return calls;
}

test('write flag blocks create and cancel', async () => {
  process.env.PG_ALLOW_WRITE = 'false';
  assert.equal((await post(valid)).status, 403);
  assert.equal((await signedIn.request('/api/bookings/1', { method: 'DELETE' })).status, 403);
  process.env.PG_ALLOW_WRITE = 'true';
});
test('invalid payload returns 400 before opening a transaction', async () => {
  pool.connect = async () => { throw new Error('must not connect'); };
  assert.equal((await post({ ...valid, end_time: '08:00' })).status, 400);
  const malformed = await signedIn.request('/api/bookings', { method: 'POST', body: '{' });
  assert.equal(malformed.status, 400);
});
test('missing room rolls back without inserting', async () => {
  const calls = mockTransaction({ missing: true });
  assert.equal((await post(valid)).status, 404);
  assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!calls.some(c => c.sql.includes('INSERT')));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
test('overlap returns 409 and rolls back', async () => {
  const calls = mockTransaction({ conflict: true });
  assert.equal((await post(valid)).status, 409);
  assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!calls.some(c => c.sql.includes('INSERT')));
});
test('create locks room before checking overlap and commits parameterized insert', async () => {
  const calls = mockTransaction();
  assert.equal((await post({ ...valid, purpose: "  O'Brien  " })).status, 201);
  assert.ok(calls[1].sql.includes('FOR UPDATE'));
  assert.deepEqual(calls.find(c => c.sql.includes('INSERT')).params, ['1', '1', '2026-10-23', '10:00', '11:00', "O'Brien"]);
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
test('database failure rolls back and hides database details', async () => {
  const calls = mockTransaction({ failure: true });
  const response = await post(valid);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error' });
  assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
test('cancellation updates status, retains row and reports missing ids', async () => {
  let sqlUsed;
  pool.query = async (sql, params) => { sqlUsed = sql; assert.deepEqual(params, ['1', '1', false]); return { rowCount: 1 }; };
  assert.equal((await signedIn.request('/api/bookings/1', { method: 'DELETE' })).status, 204);
  assert.ok(sqlUsed.startsWith("UPDATE bookings SET status = 'cancelled'"));
  pool.query = async () => ({ rowCount: 0 });
  assert.equal((await signedIn.request('/api/bookings/2', { method: 'DELETE' })).status, 404);
  assert.equal((await signedIn.request('/api/bookings/invalid', { method: 'DELETE' })).status, 400);
});

test('unauthenticated callers cannot read or change bookings', async () => {
  assert.equal((await fetch(`${base}/api/bookings`)).status, 401);
  assert.equal((await fetch(`${base}/api/bookings/1`, { method: 'DELETE' })).status, 401);
});
test('creation ignores a caller-supplied user_id', async () => {
  const calls = mockTransaction();
  assert.equal((await post({ ...valid, user_id: '999' })).status, 201);
  assert.equal(calls.find(c => c.sql.includes('INSERT')).params[0], '1');
});

test('availability requires authentication and validates the requested interval before SQL', async () => {
  const anonymous = browser(base);
  assert.equal((await anonymous.request('/api/rooms/availability?date=2026-10-26&start=10:00&end=11:00')).status, 401);
  pool.query = async () => { throw new Error('invalid interval must not query SQL'); };
  for (const query of ['date=2026-02-30&start=10:00&end=11:00', 'date=2026-10-26&start=11:00&end=10:00', 'date=2026-10-26', 'date=2026-10-26&start=25:00&end=26:00']) {
    assert.equal((await signedIn.request(`/api/rooms/availability?${query}`)).status, 400);
  }
});

test('availability includes disabled rooms and checks overlaps across all users without exposing bookings', async () => {
  pool.query = async (sql, params) => {
    assert.deepEqual(params, ['2026-10-26', '10:00', '11:00']);
    assert.match(sql, /b\.start_time < \$3::time AND b\.end_time > \$2::time/);
    assert.match(sql, /b\.status <> 'cancelled'/);
    assert.match(sql, /WHEN NOT r\.is_active THEN 'unavailable'/);
    assert.doesNotMatch(sql, /user_id|email|purpose/);
    return { rows: [{ id: '1', availability: 'available' }, { id: '2', availability: 'occupied' }, { id: '3', availability: 'unavailable' }] };
  };
  const response = await signedIn.request('/api/rooms/availability?date=2026-10-26&start=10:00&end=11:00');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.rooms.length, 3);
  assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
});
