const assert = require('node:assert/strict');
const app = require('./server');
const pool = require('./db');

(async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const statusResponse = await fetch(`${base}/api/auth/session`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.status, 'anonymous');
    console.log('GET /api/auth/session: OK; Microsoft configured:', status.configured);
    for (const resource of ['users', 'rooms', 'bookings']) {
      const response = await fetch(`${base}/api/${resource}`);
      assert.equal(response.status, 401);
      console.log(`GET /api/${resource}: OK (anonymous access blocked)`);
    }
    if (status.csrfToken) {
      const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: {
        Cookie: statusResponse.headers.get('set-cookie').split(';')[0],
        Origin: app.locals.auth.config.origin, 'X-CSRF-Token': status.csrfToken,
      } });
      assert.equal(logout.status, 204);
    }
  } catch (error) {
    console.error('API check failed:', error.code || error.name);
    process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
})();
