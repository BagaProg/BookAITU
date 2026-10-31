const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db');
const { createApp } = require('../src/server');
const { authHarness, browser } = require('./helpers/authHarness');
const service = require('../src/admin/service');
const originalConnect = pool.connect, originalQuery = pool.query;
let server, base, admin, ordinary;
const harness = authHarness({ role: 'admin' });
before(async () => {
  process.env.PG_ALLOW_WRITE = 'true';
  server = createApp({ auth: harness.options }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = browser(base); await admin.login();
  const ordinaryHarness = authHarness();
  const otherServer = createApp({ auth: ordinaryHarness.options }).listen(0, '127.0.0.1');
  await new Promise(resolve => otherServer.once('listening', resolve));
  ordinary = browser(`http://127.0.0.1:${otherServer.address().port}`); await ordinary.login();
  ordinary.server = otherServer;
});
after(async () => {
  pool.connect = originalConnect; pool.query = originalQuery;
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => ordinary.server.close(resolve));
  await pool.end();
});
const patch = (path, input, headers) => admin.request(path, { method: 'PATCH', headers, body: JSON.stringify(input) });
const actor = { id: '1', email: 'admin@astanait.edu.kz', name: 'Admin', role: 'admin', is_active: true, two_factor_enabled: true, microsoft_linked: true };
function fakeDatabase(target, { admins = 2, auditFailure = false } = {}) {
  const calls = [];
  pool.connect = async () => ({
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FOR SHARE')) return { rows: [actor] };
      if (sql.includes('FOR UPDATE')) return { rows: target ? [{ ...target }] : [] };
      if (sql.includes('SELECT count(*)')) return { rows: [{ count: admins }] };
      if (sql.startsWith('UPDATE users')) return { rows: [{ ...target, role: params[0], is_active: params[1] }] };
      if (sql.startsWith('UPDATE rooms')) return { rows: [{ ...target, name: params[0], capacity: params[1], is_active: params[2] }] };
      if (sql.startsWith('UPDATE bookings')) return { rows: [{ ...target, status: 'cancelled', cancellation_reason: params[1] }] };
      if (sql.includes('INSERT INTO admin_audit_log') && auditFailure) throw new Error('Audit store unavailable');
      return { rows: [] };
    }, release() { calls.push({ sql: 'RELEASE' }); },
  });
  return calls;
}
test('admin routes reject anonymous and ordinary users', async () => {
  for (const endpoint of ['dashboard', 'users', 'rooms', 'bookings', 'audit', 'schedules', 'schedules/source', 'schedules/rooms']) {
    assert.equal((await fetch(`${base}/api/admin/${endpoint}`)).status, 401);
    assert.equal((await ordinary.request(`/api/admin/${endpoint}`)).status, 403);
  }
});
test('administrative writes require CSRF and strict input validation', async () => {
  assert.equal((await patch('/api/admin/users/2', { role: 'admin' }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  for (const input of [{ role: 'superadmin' }, { password_hash: 'bad' }, { two_factor_enabled: false }, { is_active: 'false' }, {}]) assert.equal((await patch('/api/admin/users/2', input)).status, 400);
  for (const input of [{ capacity: -1 }, { capacity: 1.5 }, { block: 'C1.9' }, { name: 'x'.repeat(101) }]) assert.equal((await patch('/api/admin/rooms/2', input)).status, 400);
  assert.equal((await admin.request('/api/admin/bookings/2/cancel', { method: 'POST', body: '{"reason":" "}' })).status, 400);
});
test('list filters reject injection, invalid dates and unbounded pages', async () => {
  for (const path of ['users?page=0', 'rooms?limit=1000', 'bookings?from=2026-02-30', 'bookings?from=2026-10-25&to=2026-10-24', 'users?role=superadmin', 'bookings?room_id=1%20OR%201=1']) assert.equal((await admin.request(`/api/admin/${path}`)).status, 400);
});
test('room updates and their audit record commit together with parameterized values', async () => {
  const before = { id: '2', code: 'C1.1.232P', name: null, capacity: null, is_active: true };
  const calls = fakeDatabase(before);
  const response = await patch('/api/admin/rooms/2', { name: "O'Brien", capacity: 30, is_active: false });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.find(call => call.sql.startsWith('UPDATE rooms')).params, ["O'Brien", 30, false, '2']);
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO admin_audit_log')));
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
});
test('audit failure rolls back the administrative change', async () => {
  const calls = fakeDatabase({ id: '2', capacity: 20, name: null, is_active: true }, { auditFailure: true });
  await assert.rejects(service.updateRoom('1', '2', { capacity: 30 }));
  assert.ok(calls.some(call => call.sql === 'ROLLBACK')); assert.ok(!calls.some(call => call.sql === 'COMMIT'));
});
test('self-demotion and removing the last administrator are refused', async () => {
  fakeDatabase(actor);
  assert.equal((await patch('/api/admin/users/1', { role: 'user' })).status, 409);
  fakeDatabase({ ...actor, id: '2' }, { admins: 1 });
  assert.equal((await patch('/api/admin/users/2', { is_active: false })).status, 409);
});
test('legacy accounts without verified Microsoft and 2FA cannot become admins', async () => {
  fakeDatabase({ ...actor, id: '2', role: 'user', microsoft_linked: false, two_factor_enabled: false });
  assert.equal((await patch('/api/admin/users/2', { role: 'admin' })).status, 409);
});
test('changing a user revokes sessions and writes only safe audit fields', async () => {
  const before = { ...actor, id: '2', role: 'user' };
  const calls = fakeDatabase(before);
  assert.equal((await patch('/api/admin/users/2', { role: 'admin' })).status, 200);
  assert.ok(calls.some(call => call.sql.startsWith('DELETE FROM auth_sessions')));
  const event = calls.find(call => call.sql.includes('INSERT INTO admin_audit_log'));
  assert.ok(event); assert.ok(!event.params[6].includes('two_factor_secret'));
});
test('administrator cancellation retains booking and reason, repeat is a no-op', async () => {
  const booking = { id: '2', status: 'pending' };
  const calls = fakeDatabase(booking);
  const response = await admin.request('/api/admin/bookings/2/cancel', { method: 'POST', body: '{"reason":"Room maintenance"}' });
  assert.equal(response.status, 200); assert.equal((await response.json()).cancellation_reason, 'Room maintenance');
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO admin_audit_log')));
  const repeated = fakeDatabase({ ...booking, status: 'cancelled' });
  await service.cancelBooking('1', '2', 'Repeat');
  assert.ok(!repeated.some(call => call.sql.startsWith('UPDATE bookings')));
});
test('write permission flag is enforced for admin operations', async () => {
  process.env.PG_ALLOW_WRITE = 'false';
  assert.equal((await patch('/api/admin/rooms/2', { capacity: 30 })).status, 403);
  process.env.PG_ALLOW_WRITE = 'true';
});

test('schedule writes validate input and require CSRF', async()=>{
 const path='/api/admin/schedules';
 assert.equal((await admin.request(path,{method:'POST',headers:{'X-CSRF-Token':'wrong'},body:JSON.stringify({})})).status,403);
 assert.equal((await admin.request(path,{method:'POST',body:JSON.stringify({room_id:'1',kind:'class',title:'Test',starts_at:'bad',ends_at:'bad'})})).status,400);
});
test('schedule creation locks the room and saves an explicit interval', async()=>{
 const calls=[];
 pool.connect=async()=>({query:async(sql,params)=>{calls.push(sql);return sql.startsWith('SELECT')?{rowCount:1,rows:[{id:'1'}]}:sql.startsWith('INSERT')?{rowCount:1,rows:[{id:'9'}]}:{rows:[]}},release(){}});
 const response=await admin.request('/api/admin/schedules',{method:'POST',body:JSON.stringify({room_id:'1',kind:'class',title:'ICT',starts_at:'2026-11-02T08:00:00+05:00',ends_at:'2026-11-02T08:50:00+05:00'})});
 assert.equal(response.status,200);assert.ok(calls[1].includes('FOR UPDATE'));assert.equal(calls.at(-1),'COMMIT');
});
