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
      if (sql.startsWith('UPDATE users SET two_factor_enabled=false')) return { rows: [{ ...target, two_factor_enabled: false }] };
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

test('permanent booking deletion requires admin, CSRF, write flag and valid id', async () => {
  const path = '/api/admin/bookings/2';
  assert.equal((await fetch(`${base}${path}`, { method: 'DELETE' })).status, 401);
  assert.equal((await ordinary.request(path, { method: 'DELETE' })).status, 403);
  assert.equal((await admin.request(path, { method: 'DELETE', headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  process.env.PG_ALLOW_WRITE = 'false';
  try { assert.equal((await admin.request(path, { method: 'DELETE' })).status, 403); }
  finally { process.env.PG_ALLOW_WRITE = 'true'; }
  assert.equal((await admin.request('/api/admin/bookings/invalid', { method: 'DELETE' })).status, 400);
});
test('permanent deletion rejects active and missing bookings', async () => {
  for (const target of [null, { id: '2', status: 'confirmed' }]) {
    const calls = fakeDatabase(target);
    assert.equal((await admin.request('/api/admin/bookings/2', { method: 'DELETE' })).status, target ? 409 : 404);
    assert.ok(!calls.some(call => call.sql.startsWith('DELETE FROM bookings')));
    assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  }
});
test('cancelled booking deletion commits together with audit and rolls back if audit fails', async () => {
  const booking = { id: '2', status: 'cancelled', purpose: 'Study' };
  const calls = fakeDatabase(booking);
  assert.equal((await admin.request('/api/admin/bookings/2', { method: 'DELETE' })).status, 204);
  assert.deepEqual(calls.find(call => call.sql.startsWith('DELETE FROM bookings')).params, ['2']);
  const event = calls.find(call => call.sql.includes('INSERT INTO admin_audit_log'));
  assert.equal(event.params[2], 'booking.delete');
  assert.deepEqual(JSON.parse(event.params[5]), booking);
  assert.equal(event.params[6], 'null');
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
  const failed = fakeDatabase(booking, { auditFailure: true });
  await assert.rejects(service.deleteBooking('1', '2'));
  assert.ok(failed.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!failed.some(call => call.sql === 'COMMIT'));
});

test('second factor reset revokes sessions, preserves role and audits without secrets', async () => {
  const calls = fakeDatabase({ ...actor, id: '2' });
  const response = await admin.request('/api/admin/users/2/reset-2fa', { method: 'POST' });
  assert.equal(response.status, 200);
  const user = await response.json();
  assert.equal(user.two_factor_enabled, false); assert.equal(user.role, 'admin');
  const update = calls.find(call => call.sql.startsWith('UPDATE users SET two_factor_enabled=false'));
  for (const field of ['two_factor_secret=NULL', 'backup_codes=NULL', 'two_factor_last_step=NULL', 'second_factor_failures=0', 'second_factor_locked_until=NULL']) assert.ok(update.sql.includes(field));
  assert.deepEqual(update.params, ['2']);
  assert.ok(calls.some(call => call.sql.startsWith('DELETE FROM auth_sessions') && call.params[0] === '2'));
  const event = calls.find(call => call.sql.includes('INSERT INTO admin_audit_log'));
  assert.equal(event.params[2], 'user.reset_2fa');
  assert.ok(!event.params[6].includes('two_factor_secret'));
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
});

test('second factor reset enforces access, CSRF, write flag and target eligibility', async () => {
  const path = '/api/admin/users/2/reset-2fa';
  assert.equal((await fetch(`${base}${path}`, { method: 'POST' })).status, 401);
  assert.equal((await ordinary.request(path, { method: 'POST' })).status, 403);
  assert.equal((await admin.request(path, { method: 'POST', headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  process.env.PG_ALLOW_WRITE = 'false';
  try { assert.equal((await admin.request(path, { method: 'POST' })).status, 403); }
  finally { process.env.PG_ALLOW_WRITE = 'true'; }
  assert.equal((await admin.request('/api/admin/users/1/reset-2fa', { method: 'POST' })).status, 409);
  for (const target of [null, { ...actor, id: '2', is_active: false }, { ...actor, id: '2', microsoft_linked: false }]) {
    fakeDatabase(target);
    assert.equal((await admin.request(path, { method: 'POST' })).status, target ? 409 : 404);
  }
});

test('second factor reset rolls back if audit fails', async () => {
  const calls = fakeDatabase({ ...actor, id: '2' }, { auditFailure: true });
  await assert.rejects(service.resetSecondFactor('1', '2'));
  assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some(call => call.sql === 'COMMIT'));
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
 pool.connect=async()=>({query:async(sql,params)=>{calls.push(sql);if(sql.includes('FOR SHARE'))return {rows:[actor]};return sql.startsWith('SELECT')?{rowCount:1,rows:[{id:'1'}]}:sql.startsWith('INSERT')?{rowCount:1,rows:[{id:'9'}]}:{rows:[]}},release(){}});
 const response=await admin.request('/api/admin/schedules',{method:'POST',body:JSON.stringify({room_id:'1',kind:'class',title:'ICT',starts_at:'2026-11-02T08:00:00+05:00',ends_at:'2026-11-02T08:50:00+05:00'})});
 assert.equal(response.status,201);assert.ok(calls.some(sql=>sql.includes('FOR UPDATE')));assert.ok(calls.some(sql=>sql.includes('INSERT INTO admin_audit_log')));assert.equal(calls.at(-1),'COMMIT');
});

test('schedule save rolls back when audit fails', async()=>{
 const calls=[];
 pool.connect=async()=>({query:async(sql)=>{calls.push(sql);if(sql.includes('FOR SHARE'))return {rows:[actor]};if(sql.includes('admin_audit_log'))throw new Error('Audit unavailable');return {rowCount:1,rows:[{id:'9'}]};},release(){}});
 const response=await admin.request('/api/admin/schedules',{method:'POST',body:JSON.stringify({room_id:'1',kind:'closure',title:'Repair',starts_at:'2026-11-02T08:00:00+05:00',ends_at:'2026-11-02T08:50:00+05:00'})});
 assert.equal(response.status,500);assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.includes('COMMIT'));
});
test('access rules and deleted schedules are recorded in audit', async()=>{
 for(const [path,method,body] of [['/api/admin/schedules/rules/1','PUT',{access_rules:'Staff only',student_access:false}],['/api/admin/schedules/9','DELETE',null]]){
 const calls=[];
 pool.connect=async()=>({query:async(sql,params)=>{calls.push({sql,params});if(sql.includes('FOR SHARE'))return {rows:[actor]};return {rowCount:1,rows:[{id:'9',room_id:'1',access_rules:'',student_access:true}]};},release(){}});
 const response=await admin.request(path,{method,...(body?{body:JSON.stringify(body)}:{})});
 assert.equal(response.status,method==='PUT'?200:204);assert.ok(calls.some(c=>c.sql.includes('INSERT INTO admin_audit_log')));assert.equal(calls.at(-1).sql,'COMMIT');
 }
});


test('approval rechecks occupancy, rejects conflicts and audits the decision', async () => {
  for (const conflict of [false, true]) {
    const calls = [];
    pool.connect = async () => ({ release() {}, async query(sql, params) {
      calls.push({sql,params});
      if (sql.includes('FROM users')) return {rows:[actor]};
      if (sql.includes('FROM bookings') && sql.includes('FOR UPDATE')) return {rows:[{id:'2',room_id:'1',status:'pending',future:true,date_text:'2099-01-01',start_time:'10:00:00',end_time:'11:00:00'}]};
      if (sql.includes('FROM rooms')) return {rows:[{id:'1',is_active:true,student_access:true}]};
      if (sql.includes('FROM room_events')) return {rows:[]};
      if (sql.includes('FROM bookings')) { assert.match(sql,/status='confirmed'/); return {rowCount:conflict?1:0}; }
      if (sql.startsWith('UPDATE bookings')) return {rows:[{id:'2',status:params[1]}]};
      return {rows:[]};
    }});
    const response = await admin.request('/api/admin/bookings/2/approve',{method:'POST'});
    assert.equal(response.status,conflict?409:200);
    assert.equal(calls.some(c=>c.sql==='COMMIT'),!conflict);
    assert.equal(calls.some(c=>c.sql.includes('INSERT INTO admin_audit_log')),!conflict);
  }
});
test('review endpoints enforce access and reject requests already decided', async () => {
  for (const action of ['approve','reject']) {
    const path = `/api/admin/bookings/2/${action}`;
    assert.equal((await ordinary.request(path,{method:'POST',body:JSON.stringify({reason:'Not suitable'})})).status,403);
    assert.equal((await admin.request(path,{method:'POST',headers:{'X-CSRF-Token':'wrong'}})).status,403);
    fakeDatabase({id:'2',status:'confirmed'});
    assert.equal((await admin.request(path,{method:'POST',body:JSON.stringify({reason:'Not suitable'})})).status,409);
  }
});
