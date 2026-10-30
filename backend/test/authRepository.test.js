const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const otp = require('otplib');
const pool = require('../src/db');
const { createRepository } = require('../src/auth/repository');
const { encrypt, decrypt, recoveryCodes } = require('../src/auth/crypto');

const originalConnect = pool.connect;
after(async () => { pool.connect = originalConnect; await pool.end(); });
const key = crypto.randomBytes(32);
function database(user) {
  const calls = [];
  pool.connect = async () => ({
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT * FROM users')) return { rows: [{ ...user }] };
      if (sql.startsWith('UPDATE users SET second_factor_failures')) {
        user.second_factor_failures = params[0]; user.second_factor_locked_until = params[1]; return { rows: [] };
      }
      if (sql.startsWith('UPDATE users SET two_factor_enabled')) {
        Object.assign(user, { two_factor_enabled: true, two_factor_secret: params[0], backup_codes: JSON.parse(params[1]), two_factor_last_step: params[2], second_factor_failures: 0, second_factor_locked_until: null });
        return { rows: [{ ...user }] };
      }
      return { rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  });
  return { repo: createRepository({ key }), calls };
}
const initialUser = () => ({ id: '1', email: 'member@astanait.edu.kz', name: 'Member', role: 'user', is_active: true,
  microsoft_id: 'verified-tenant:object-id', two_factor_enabled: false, two_factor_secret: null, backup_codes: null,
  two_factor_last_step: null, second_factor_failures: 0, second_factor_locked_until: null });

test('enrollment saves an encrypted secret and hashed recovery codes under a row lock', async () => {
  const user = initialUser(), secret = otp.generateSecret();
  const { repo, calls } = database(user);
  const result = await repo.secondFactor('1', { enrollmentSecret: secret, code: await otp.generate({ secret }) });
  assert.equal(result.ok, true); assert.equal(result.recoveryCodes.length, 10);
  assert.equal(decrypt(user.two_factor_secret, key), secret);
  assert.ok(user.backup_codes.every(code => !result.recoveryCodes.includes(code)));
  assert.ok(calls.find(c => c.sql.startsWith('SELECT *')).sql.endsWith('FOR UPDATE'));
  assert.ok(calls.some(c => c.sql === 'COMMIT'));
  assert.ok(!('two_factor_secret' in result.user));
});
test('a recovery code can be consumed only once and used TOTP is rejected', async () => {
  const user = initialUser(), secret = otp.generateSecret(), recovery = recoveryCodes();
  Object.assign(user, { two_factor_enabled: true, two_factor_secret: encrypt(secret, key), backup_codes: recovery.hashes });
  const { repo } = database(user);
  assert.equal((await repo.secondFactor('1', { code: recovery.codes[0] })).ok, true);
  assert.equal(user.backup_codes.length, 9);
  assert.equal((await repo.secondFactor('1', { code: recovery.codes[0] })).ok, false);
  const code = await otp.generate({ secret });
  assert.equal((await repo.secondFactor('1', { code })).ok, true);
  assert.equal((await repo.secondFactor('1', { code })).ok, false);
});
test('five failures persist a per-account lock even across new challenges', async () => {
  const user = initialUser(), secret = otp.generateSecret();
  Object.assign(user, { two_factor_enabled: true, two_factor_secret: encrypt(secret, key), backup_codes: [] });
  const { repo } = database(user);
  for (let i = 0; i < 5; i++) await repo.secondFactor('1', { code: 'not-a-valid-code' });
  assert.equal(user.second_factor_failures, 5);
  const result = await repo.secondFactor('1', { code: await otp.generate({ secret }) });
  assert.equal(result.code, 'SECOND_FACTOR_LOCKED'); assert.equal(result.status, 429);
});
test('disabled accounts cannot complete enrollment', async () => {
  const user = initialUser(); user.is_active = false;
  const { repo, calls } = database(user);
  await assert.rejects(repo.secondFactor('1', { code: '123456', enrollmentSecret: otp.generateSecret() }), { code: 'ACCOUNT_DISABLED' });
  assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
});
test('matching an email never links a Microsoft identity to a legacy account', async () => {
  pool.connect = async () => ({
    async query(sql) {
      if (sql.startsWith('SELECT * FROM users')) return { rows: [] };
      if (sql.startsWith('SELECT id FROM users')) return { rows: [{ id: '99' }] };
      if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) throw new Error('Must not claim legacy account');
      return { rows: [] };
    }, release() {},
  });
  const repo = createRepository({ key });
  await assert.rejects(repo.resolveIdentity({ microsoftId: 'new-identity', email: 'existing@astanait.edu.kz', name: 'Member' }), { code: 'ACCOUNT_LINK_REQUIRED' });
});
