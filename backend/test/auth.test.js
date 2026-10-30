const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const otp = require('otplib');
const pool = require('../src/db');
const { createApp } = require('../src/server');
const { authHarness, browser } = require('./helpers/authHarness');
const { validateIdentity, getConfig } = require('../src/auth/config');
const { encrypt, decrypt, recoveryCodes, hashRecovery, verifyTotp } = require('../src/auth/crypto');

after(() => pool.end());
async function withApp(options, work) {
  const app = createApp({ auth: options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await work(browser(base), base); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('identity requires the university tenant, member claim, object id and exact domain', () => {
  const h = authHarness();
  assert.equal(validateIdentity(h.claims, h.options.config).email, 'test@astanait.edu.kz');
  for (const claims of [{ ...h.claims, tid: 'other-tenant' }, { ...h.claims, acct: 1 }, { ...h.claims, acct: undefined },
    { ...h.claims, preferred_username: 'a@outlook.com' }, { ...h.claims, preferred_username: 'a@evilastanait.edu.kz' },
    { ...h.claims, preferred_username: 'a@astanait.edu.kz.evil.com' }, { ...h.claims, oid: '' }]) {
    assert.throws(() => validateIdentity(claims, h.options.config), { code: 'UNIVERSITY_ACCOUNT_REQUIRED' });
  }
});

test('identity failures distinguish missing Entra configuration from guests without exposing claims', () => {
  const h = authHarness();
  for (const [change, reason] of [
    [{ acct: undefined }, 'MEMBER_CLAIM_MISSING'], [{ acct: 1 }, 'MEMBER_ACCOUNT_REQUIRED'],
    [{ tid: 'different' }, 'TENANT_MISMATCH'], [{ oid: '' }, 'OBJECT_ID_MISSING'],
    [{ preferred_username: 'private@example.com' }, 'UNIVERSITY_DOMAIN_REQUIRED'],
  ]) assert.throws(() => validateIdentity({ ...h.claims, ...change }, h.options.config), { code: 'UNIVERSITY_ACCOUNT_REQUIRED', reason });
});
test('secrets are authenticated ciphertext and recovery codes are high-entropy hashes', () => {
  const key = crypto.randomBytes(32), secret = otp.generateSecret();
  const encrypted = encrypt(secret, key);
  assert.ok(!encrypted.includes(secret)); assert.equal(decrypt(encrypted, key), secret);
  assert.throws(() => decrypt(encrypted, crypto.randomBytes(32)));
  const recovery = recoveryCodes();
  assert.equal(new Set(recovery.codes).size, 10);
  assert.ok(recovery.codes.every((code, i) => hashRecovery(code) === recovery.hashes[i] && !recovery.hashes.includes(code)));
});
test('TOTP verifies correct codes, rejects invalid codes and prevents replay', async () => {
  const secret = otp.generateSecret(); const code = await otp.generate({ secret });
  const result = await verifyTotp(secret, code, null);
  assert.equal(result.valid, true); assert.ok(Number.isInteger(result.timeStep));
  assert.equal((await verifyTotp(secret, code, result.timeStep)).valid, false);
  assert.equal((await verifyTotp(secret, 'abcdef', null)).valid, false);
});
test('production rejects missing settings and invalid origins', () => {
  assert.throws(() => getConfig({ NODE_ENV: 'production' }));
  assert.throws(() => getConfig({ FRONTEND_ORIGIN: 'http://untrusted.example' }));
});
test('Microsoft first factor alone cannot access protected routes, CSRF is required', async () => {
  const h = authHarness();
  await withApp(h.options, async client => {
    assert.equal((await client.request('/api/rooms')).status, 401);
    await client.microsoft();
    assert.equal((await client.status()).status, 'two_factor_required');
    assert.equal((await client.request('/api/rooms')).status, 401);
    assert.equal((await client.request('/api/auth/2fa/verify', { method: 'POST', headers: { 'X-CSRF-Token': 'wrong' }, body: '{"code":"123456"}' })).status, 403);
    assert.equal((await client.request('/api/auth/2fa/verify', { method: 'POST', body: '{"code":"999999"}' })).status, 401);
    assert.equal((await client.status()).status, 'two_factor_required');
  });
});
test('enrollment produces a QR code and elevates session only after confirmation', async () => {
  const h = authHarness({ enabled: false });
  await withApp(h.options, async client => {
    await client.microsoft();
    assert.equal((await client.status()).status, 'enrollment_required');
    const setup = await (await client.request('/api/auth/2fa/setup', { method: 'POST' })).json();
    assert.ok(setup.secret); assert.ok(setup.qrCode.startsWith('data:image/png;base64,'));
    const result = await (await client.request('/api/auth/2fa/confirm', { method: 'POST', body: '{"code":"123456"}' })).json();
    assert.equal(result.status, 'authenticated'); assert.equal(result.recoveryCodes.length, 1);
    const status = await client.status(); assert.equal(status.status, 'authenticated');
    assert.ok(!('two_factor_secret' in status.user));
    await client.request('/api/auth/logout', { method: 'POST' });
    assert.equal((await client.status()).status, 'anonymous');
  });
});
test('wrong OAuth state and guest identity cannot create a pending login', async () => {
  const h = authHarness();
  await withApp(h.options, async client => {
    await client.request('/api/auth/microsoft');
    const bad = await client.request('/api/auth/microsoft/callback?state=wrong&code=x');
    assert.ok(bad.headers.get('location').includes('MICROSOFT_LOGIN_FAILED'));
    assert.equal((await client.status()).status, 'anonymous');
    h.claims.acct = 1;
    const guest = await client.microsoft();
    assert.ok(guest.headers.get('location').includes('UNIVERSITY_ACCOUNT_REQUIRED'));
    assert.equal((await client.status()).status, 'anonymous');
  });
});

test('missing member claim produces a safe actionable reason and no pending login', async () => {
  const h = authHarness(); delete h.claims.acct;
  await withApp(h.options, async client => {
    const result = await client.microsoft();
    const location = new URL(result.headers.get('location'));
    assert.equal(location.searchParams.get('auth_reason'), 'MEMBER_CLAIM_MISSING');
    assert.equal(location.searchParams.get('auth_error'), 'UNIVERSITY_ACCOUNT_REQUIRED');
    assert.ok(!result.headers.get('location').includes(h.user.email));
    assert.equal((await client.status()).status, 'anonymous');
  });
});
test('full login grants a session, blocks user directory for ordinary users, and logout revokes it', async () => {
  const h = authHarness();
  await withApp(h.options, async client => {
    await client.login(); assert.equal((await client.status()).status, 'authenticated');
    assert.equal((await client.request('/api/users')).status, 403);
    await client.request('/api/auth/logout', { method: 'POST' });
    assert.equal((await client.request('/api/bookings')).status, 401);
  });
});
