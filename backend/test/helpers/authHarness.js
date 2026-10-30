const session = require('express-session');
const crypto = require('node:crypto');
const { getConfig } = require('../../src/auth/config');

function authHarness({ enabled = true, role = 'user' } = {}) {
  const config = getConfig({ NODE_ENV: 'development', PG_ALLOW_WRITE: 'true', FRONTEND_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: crypto.randomBytes(48).toString('hex'), AUTH_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    MICROSOFT_TENANT_ID: '11111111-1111-4111-8111-111111111111', MICROSOFT_CLIENT_ID: '22222222-2222-4222-8222-222222222222', MICROSOFT_CLIENT_SECRET: 'test-only' });
  const user = { id: '1', email: 'test@astanait.edu.kz', name: 'Test member', role, two_factor_enabled: enabled };
  const claims = { tid: config.tenant, oid: '33333333-3333-4333-8333-333333333333', acct: 0, preferred_username: user.email, name: user.name };
  const provider = {
    async begin() { return { url: 'https://login.microsoftonline.com/test', pending: { state: 'test-state', expires: Date.now() + 600000 } }; },
    async finish() { return claims; },
  };
  const repo = {
    async resolveIdentity() { return { ...user }; },
    async findUser() { return { ...user }; },
    async secondFactor(id, input) {
      if (input.code !== '123456') return { ok: false, code: 'INVALID_SECOND_FACTOR', status: 401 };
      user.two_factor_enabled = true;
      return { ok: true, user: { ...user }, ...(input.enrollmentSecret ? { recoveryCodes: ['test-recovery-code'] } : {}) };
    },
  };
  return { options: { config, store: new session.MemoryStore(), provider, repo }, user, claims };
}

function browser(base) {
  let cookie = '', csrf;
  return {
    async request(path, options = {}) {
      const response = await fetch(base + path, { ...options, redirect: 'manual', headers: {
        Cookie: cookie, Origin: 'http://localhost:5173', ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers,
      } });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    },
    async status() { const value = await (await this.request('/api/auth/session')).json(); csrf = value.csrfToken; return value; },
    async microsoft() {
      await this.request('/api/auth/microsoft');
      return this.request('/api/auth/microsoft/callback?code=test-code&state=test-state');
    },
    async login() {
      await this.microsoft(); await this.status();
      const response = await this.request('/api/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code: '123456' }) });
      if (response.status !== 200) throw new Error('Test login failed');
      const value = await response.json(); csrf = value.csrfToken; return value;
    },
  };
}
module.exports = { authHarness, browser };
