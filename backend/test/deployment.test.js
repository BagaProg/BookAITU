const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db');
const { createApp } = require('../src/server');
const { getConfig } = require('../src/auth/config');
const { authHarness } = require('./helpers/authHarness');

after(() => pool.end());

test('Render URLs configure the production origin and Microsoft callback', () => {
  const config = getConfig({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://bookaitu-test.onrender.com',
    PG_ALLOW_WRITE: 'true', SESSION_SECRET: 's'.repeat(48), AUTH_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    MICROSOFT_TENANT_ID: '11111111-1111-4111-8111-111111111111', MICROSOFT_CLIENT_ID: '22222222-2222-4222-8222-222222222222', MICROSOFT_CLIENT_SECRET: 'test-only' });
  assert.equal(config.origin, 'https://bookaitu-test.onrender.com');
  assert.equal(config.redirectUri, 'https://bookaitu-test.onrender.com/api/auth/microsoft/callback');
});

test('combined service serves the SPA and health endpoint while preserving API protection', async () => {
  const previous = process.env.SERVE_FRONTEND;
  process.env.SERVE_FRONTEND = 'true';
  const app = createApp({ auth: authHarness().options });
  if (previous === undefined) delete process.env.SERVE_FRONTEND;
  else process.env.SERVE_FRONTEND = previous;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/healthz`);
    assert.deepEqual(await health.json(), { status: 'ok' });
    for (const route of ['/', '/finder']) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(await response.text(), /id="root"/);
    }
    assert.equal((await fetch(`${base}/api/bookings`)).status, 401);
    const missing = await fetch(`${base}/api/does-not-exist`);
    assert.match(missing.headers.get('content-type'), /application\/json/);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
