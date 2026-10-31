const pool = require('../db');
const fail = (status, message) => Object.assign(new Error(message), { status, code: 'ADMIN_OPERATION_REJECTED' });
const userFields = 'id,email,name,role,is_active,two_factor_enabled,microsoft_id IS NOT NULL AS microsoft_linked';
const roomFields = 'id,code,name,block,floor,number,room_type,capacity,is_active';
const bookingFields = 'id,user_id,room_id,booking_date,start_time,end_time,purpose,status,cancelled_at,cancelled_by,cancellation_reason';

async function audit(client, actor, action, type, id, before, after) {
  await client.query(`INSERT INTO admin_audit_log(actor_id,actor_email,action,resource_type,resource_id,before_data,after_data)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`, [actor.id, actor.email, action, type, id, JSON.stringify(before), JSON.stringify(after)]);
}
async function adminTransaction(actorId, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize administrative writes, including concurrent attempts to remove the last administrator.
    await client.query('SELECT pg_advisory_xact_lock(20261024,2)');
    const actor = (await client.query(`SELECT ${userFields} FROM users WHERE id=$1 FOR SHARE`, [actorId])).rows[0];
    if (!actor?.is_active || actor.role !== 'admin' || !actor.two_factor_enabled) throw fail(403, 'Administrator access required');
    const value = await work(client, actor);
    await client.query('COMMIT'); return value;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
const safeUser = user => ({ ...user, id: String(user.id) });
async function updateUser(actorId, id, input) {
  return adminTransaction(actorId, async (client, actor) => {
    const before = (await client.query(`SELECT ${userFields} FROM users WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before) throw fail(404, 'User not found');
    const next = { role: input.role ?? before.role, is_active: input.is_active ?? before.is_active };
    if (String(id) === String(actorId) && (next.role !== 'admin' || !next.is_active)) throw fail(409, 'You cannot demote or disable your own administrator account');
    if (before.role === 'admin' && before.is_active && (next.role !== 'admin' || !next.is_active)) {
      const count = (await client.query("SELECT count(*)::int AS count FROM users WHERE role='admin' AND is_active")).rows[0].count;
      if (count <= 1) throw fail(409, 'The last active administrator must be retained');
    }
    if (next.role === 'admin' && (!before.microsoft_linked || !before.two_factor_enabled || !next.is_active)) throw fail(409, 'An administrator requires an active Microsoft account with configured 2FA');
    if (next.role === before.role && next.is_active === before.is_active) return safeUser(before);
    const after = (await client.query(`UPDATE users SET role=$1,is_active=$2 WHERE id=$3 RETURNING ${userFields}`, [next.role, next.is_active, id])).rows[0];
    await client.query("DELETE FROM auth_sessions WHERE sess->>'userId'=$1 OR sess->'pending'->>'userId'=$1", [String(id)]);
    await audit(client, actor, 'user.update', 'user', id, before, after);
    return safeUser(after);
  });
}
async function updateRoom(actorId, id, input) {
  return adminTransaction(actorId, async (client, actor) => {
    const before = (await client.query(`SELECT ${roomFields} FROM rooms WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before) throw fail(404, 'Room not found');
    const next = { name: Object.hasOwn(input, 'name') ? input.name : before.name,
      capacity: Object.hasOwn(input, 'capacity') ? input.capacity : before.capacity, is_active: input.is_active ?? before.is_active };
    if (next.name === before.name && next.capacity === before.capacity && next.is_active === before.is_active) return before;
    const after = (await client.query(`UPDATE rooms SET name=$1,capacity=$2,is_active=$3,details_updated_at=now() WHERE id=$4 RETURNING ${roomFields}`, [next.name, next.capacity, next.is_active, id])).rows[0];
    await audit(client, actor, 'room.update', 'room', id, before, after); return after;
  });
}
async function cancelBooking(actorId, id, reason) {
  return adminTransaction(actorId, async (client, actor) => {
    const before = (await client.query(`SELECT ${bookingFields} FROM bookings WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before) throw fail(404, 'Booking not found');
    if (before.status === 'cancelled') return before;
    const after = (await client.query(`UPDATE bookings SET status='cancelled',cancelled_at=now(),cancelled_by=$1,cancellation_reason=$2 WHERE id=$3 RETURNING ${bookingFields}`, [actorId, reason, id])).rows[0];
    await audit(client, actor, 'booking.cancel', 'booking', id, before, after); return after;
  });
}
module.exports = { updateUser, updateRoom, cancelBooking, audit, userFields, roomFields, fail };
