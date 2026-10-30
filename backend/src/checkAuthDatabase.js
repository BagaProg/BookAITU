// Real PostgreSQL SQL/constraint check. Only a transaction-local temporary users table is written.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const otp = require('otplib');
const pool = require('./db');
const { createRepository } = require('./auth/repository');

(async () => {
  const originalConnect = pool.connect;
  let client;
  try {
    client = await originalConnect.call(pool);
    assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, 'BookAITU');
    const before = (await client.query('SELECT (SELECT count(*) FROM public.users) AS users,(SELECT count(*) FROM public.rooms) AS rooms,(SELECT count(*) FROM public.bookings) AS bookings')).rows[0];
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL) ON COMMIT DROP');
    await client.query('SET LOCAL search_path=pg_temp,public');
    const user = (await client.query("INSERT INTO pg_temp.users(microsoft_id,email,name) VALUES('test-tenant:test-object','auth-probe@astanait.edu.kz','Temporary auth probe') RETURNING id")).rows[0];
    // Keep repository transactions inside the outer rollback-only test transaction.
    pool.connect = async () => ({
      query(sql, params) {
        const translated = sql === 'BEGIN' ? 'SAVEPOINT auth_operation' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT auth_operation' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT auth_operation' : sql;
        return client.query(translated, params);
      }, release() {},
    });
    const repo = createRepository({ key: crypto.randomBytes(32) });
    const secret = otp.generateSecret();
    const code = await otp.generate({ secret });
    const enrolled = await repo.secondFactor(user.id, { enrollmentSecret: secret, code });
    assert.equal(enrolled.ok, true); assert.equal(enrolled.recoveryCodes.length, 10);
    assert.equal((await repo.secondFactor(user.id, { code })).ok, false);
    assert.equal((await repo.secondFactor(user.id, { code: enrolled.recoveryCodes[0] })).ok, true);
    assert.equal((await repo.secondFactor(user.id, { code: enrolled.recoveryCodes[0] })).ok, false);
    for (let i = 0; i < 4; i++) await repo.secondFactor(user.id, { code: 'invalid-code' });
    assert.equal((await repo.secondFactor(user.id, { code: enrolled.recoveryCodes[1] })).code, 'SECOND_FACTOR_LOCKED');
    await client.query('ROLLBACK');
    const after = (await client.query('SELECT (SELECT count(*) FROM public.users) AS users,(SELECT count(*) FROM public.rooms) AS rooms,(SELECT count(*) FROM public.bookings) AS bookings')).rows[0];
    assert.deepEqual(after, before);
    console.log('Real PostgreSQL auth check: enrollment, TOTP replay rejection, single-use recovery codes and account lock passed.');
    console.log('Temporary transaction rolled back; public user/room/booking counts unchanged.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Auth database check failed:', error.code || error.name);
    process.exitCode = 1;
  } finally {
    pool.connect = originalConnect;
    if (client) client.release();
    await pool.end();
  }
})();
