// Trusted local operator only. Not an HTTP endpoint or a login bypass.
const pool = require('./db');
const { audit, userFields } = require('./admin/service');
(async () => {
  let client;
  try {
    const email = process.argv[2];
    if (process.env.PG_ALLOW_WRITE !== 'true' || typeof email !== 'string' || !/^[^\s@]+@astanait\.edu\.kz$/.test(email)) throw new Error('University email and write permission required');
    client = await pool.connect();
    if ((await client.query('SELECT current_database() AS name')).rows[0].name !== 'BookAITU') throw new Error('Wrong database');
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20261024,2)');
    const before = (await client.query(`SELECT ${userFields} FROM users WHERE email=$1 FOR UPDATE`, [email])).rows[0];
    if (!before?.is_active || !before.microsoft_linked || !before.two_factor_enabled) throw new Error('Verified active Microsoft account with 2FA required');
    if (before.role === 'admin') { await client.query('ROLLBACK'); console.log('Requested account is already an administrator'); return; }
    const admins = (await client.query("SELECT count(*)::int AS count FROM users WHERE role='admin' AND is_active")).rows[0].count;
    if (admins !== 0) throw new Error('An administrator already exists; use the administrative API');
    const after = (await client.query(`UPDATE users SET role='admin' WHERE id=$1 RETURNING ${userFields}`, [before.id])).rows[0];
    await audit(client, after, 'user.bootstrap_admin', 'user', after.id, before, after);
    await client.query('COMMIT');
    console.log('First administrator assigned to the explicitly confirmed account; audit event saved.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Administrator bootstrap stopped:', error.code || error.message); process.exitCode = 1;
  } finally { if (client) client.release(); await pool.end(); }
})();
