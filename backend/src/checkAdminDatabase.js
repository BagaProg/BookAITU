const assert = require('node:assert/strict');
const pool = require('./db');
const { createApp } = require('./server');
const { authHarness, browser } = require('../test/helpers/authHarness');

(async () => {
  const originalConnect = pool.connect, originalQuery = pool.query;
  let client, server;
  try {
    client = await originalConnect.call(pool);
    const before = (await client.query('SELECT (SELECT count(*) FROM public.users) AS users,(SELECT count(*) FROM public.rooms) AS rooms,(SELECT count(*) FROM public.bookings) AS bookings,(SELECT count(*) FROM public.admin_audit_log) AS audit')).rows[0];
    await client.query('BEGIN');
    for (const table of ['users', 'rooms', 'bookings', 'auth_sessions', 'admin_audit_log']) await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    await client.query('SET LOCAL search_path=pg_temp,public');
    const admin = (await client.query("INSERT INTO users(email,name,microsoft_id,role,two_factor_enabled,two_factor_secret) VALUES('admin-probe@astanait.edu.kz','Admin probe','test:admin','admin',true,'encrypted-test-placeholder') RETURNING id")).rows[0];
    const member = (await client.query("INSERT INTO users(email,name,microsoft_id,two_factor_enabled,two_factor_secret) VALUES('member-probe@astanait.edu.kz','Member probe','test:member',true,'encrypted-test-placeholder') RETURNING id")).rows[0];
    const room = (await client.query("INSERT INTO rooms(block,floor,number,capacity) VALUES('C1.1',2,'232P',30) RETURNING id")).rows[0];
    await client.query("INSERT INTO bookings(id,user_id,room_id,booking_date,start_time,end_time,purpose) VALUES(1,$1,$2,CURRENT_DATE,'10:00','11:00','Integration probe')", [member.id, room.id]);
    await client.query("INSERT INTO auth_sessions(sid,sess,expire) VALUES('temporary-probe', $1::json, now()+interval '1 hour')", [JSON.stringify({ userId: String(member.id) })]);
    pool.query = (sql, params) => client.query(sql, params);
    pool.connect = async () => ({ query(sql, params) {
      const translated = sql.startsWith('BEGIN') ? 'SAVEPOINT admin_operation' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT admin_operation' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT admin_operation' : sql;
      return client.query(translated, params);
    }, release() {} });
    const harness = authHarness({ role: 'admin' }); harness.user.id = String(admin.id);
    server = createApp({ auth: harness.options }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const browserClient = browser(`http://127.0.0.1:${server.address().port}`); await browserClient.login();
    const get = async path => { const response = await browserClient.request(path); assert.equal(response.status, 200); return response.json(); };
    const stats = await get('/api/admin/dashboard');
    assert.equal(stats.metrics.users_total, 2); assert.equal(stats.metrics.rooms_total, 1); assert.equal(stats.metrics.bookings_total, 1); assert.equal(stats.upcoming.length, 7);
    for (const path of ['users', 'rooms', 'bookings', 'audit']) {
      const result = await get(`/api/admin/${path}?page=1&limit=10`);
      assert.ok(Array.isArray(result.items)); assert.equal(typeof result.total, 'number');
      assert.ok(result.items.every(row => typeof row.id === 'string'));
    }
    assert.equal((await get('/api/admin/rooms?q=232P')).total, 1);
    const empty = await get('/api/admin/rooms?page=99'); assert.equal(empty.total, 1); assert.equal(empty.items.length, 0);
    const patch = async (path, input) => browserClient.request(path, { method: 'PATCH', body: JSON.stringify(input) });
    assert.equal((await patch(`/api/admin/rooms/${room.id}`, { capacity: 40, is_active: false })).status, 200);
    assert.equal((await patch(`/api/admin/users/${member.id}`, { role: 'admin' })).status, 200);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM auth_sessions WHERE sid='temporary-probe'")).rows[0].count, 0);
    assert.equal((await patch(`/api/admin/users/${admin.id}`, { role: 'user' })).status, 409);
    const cancel = await browserClient.request('/api/admin/bookings/1/cancel', { method: 'POST', body: '{"reason":"Integration cancellation"}' });
    assert.equal(cancel.status, 200); assert.equal((await cancel.json()).status, 'cancelled');
    const audit = await get('/api/admin/audit'); assert.equal(audit.total, 3);
    assert.ok(audit.items.every(row => !JSON.stringify(row).includes('encrypted-test-placeholder')));
    assert.equal((await get('/api/admin/bookings?status=cancelled')).total, 1);
    await new Promise(resolve => server.close(resolve)); server = null;
    await client.query('ROLLBACK');
    const after = (await client.query('SELECT (SELECT count(*) FROM public.users) AS users,(SELECT count(*) FROM public.rooms) AS rooms,(SELECT count(*) FROM public.bookings) AS bookings,(SELECT count(*) FROM public.admin_audit_log) AS audit')).rows[0];
    assert.deepEqual(after, before);
    console.log('Real PostgreSQL admin integration passed: dashboard, all lists, filters/pagination, room edit, role update, session revocation, self-protection, cancellation and audit.');
    console.log('Rolled back all temporary data. Public users/rooms/bookings/audit counts unchanged.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Admin integration failed:', error.code || error.name); process.exitCode = 1;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.connect = originalConnect; pool.query = originalQuery;
    if (client) client.release(); await pool.end();
  }
})();
