const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const { rateLimit } = require('express-rate-limit');
const QRCode = require('qrcode');
const pool = require('../db');
const { getConfig, validateIdentity, token, equal } = require('./config');
const { generateSecret, generateURI, encrypt, decrypt } = require('./crypto');
const { createMicrosoft } = require('./microsoft');
const { createRepository } = require('./repository');

const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
const save = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
const destroy = req => new Promise((resolve, reject) => req.session ? req.session.destroy(error => error ? reject(error) : resolve()) : resolve());

function createAuth(options = {}) {
  const config = options.config || getConfig();
  const repo = options.repo || createRepository(config);
  const provider = options.provider || createMicrosoft(config);
  const router = express.Router();
  const store = options.store || (config.secret.length >= 32 ? new PgStore({ pool, tableName: 'auth_sessions', createTableIfMissing: false,
    pruneSessionInterval: 900, errorLog: () => console.error('Session store error') }) : null);
  const sessionMiddleware = store ? session({ store, name: config.cookieName, secret: config.secret,
    resave: false, saveUninitialized: false, rolling: false,
    cookie: { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/', maxAge: config.challengeMs } }) : (req, res, next) => next();
  const unavailable = (req, res, next) => config.configured ? next() : res.status(503).json({ error: 'Microsoft login is not configured', code: 'AUTH_NOT_CONFIGURED' });
  const csrf = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('Origin') !== config.origin || !equal(req.get('X-CSRF-Token'), req.session?.csrf)) {
      return res.status(403).json({ error: 'Invalid request verification token', code: 'CSRF_INVALID' });
    }
    next();
  };
  const pending = (req, res, next) => {
    if (!req.session?.pending || req.session.pending.expires <= Date.now()) return res.status(401).json({ error: 'Sign in with Microsoft again', code: 'MICROSOFT_LOGIN_REQUIRED' });
    next();
  };
  const factorLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  router.get('/session', async (req, res) => {
    if (!store) return res.json({ status: 'anonymous', configured: false });
    req.session.csrf ||= token();
    let user = null, status = 'anonymous';
    if (req.session.userId) {
      user = await repo.findUser(req.session.userId);
      if (user?.two_factor_enabled && req.session.authenticatedAt > Date.now() - config.sessionMs) status = 'authenticated';
      else { await regenerate(req); req.session.csrf = token(); user = null; }
    } else if (req.session.pending?.expires > Date.now()) {
      user = await repo.findUser(req.session.pending.userId);
      if (user) status = user.two_factor_enabled ? 'two_factor_required' : 'enrollment_required';
    }
    res.json({ status, configured: config.configured, csrfToken: req.session.csrf, user });
  });
  router.get('/microsoft', unavailable, rateLimit({ windowMs: 60000, limit: 10 }), async (req, res) => {
    await regenerate(req);
    const { url, pending: oauth } = await provider.begin();
    req.session.oauth = oauth; req.session.csrf = token();
    await save(req);
    res.redirect(url);
  });
  router.get('/microsoft/callback', unavailable, async (req, res) => {
    const oauth = req.session?.oauth;
    delete req.session.oauth;
    await save(req);
    try {
      if (!oauth || oauth.expires <= Date.now() || !equal(req.query.state, oauth.state) || req.query.error) throw new Error('Invalid OAuth callback');
      const claims = await provider.finish(new URL(req.originalUrl, 'http://localhost').search, oauth);
      const profile = validateIdentity(claims, config);
      const user = await repo.resolveIdentity(profile);
      await regenerate(req);
      req.session.csrf = token();
      req.session.pending = { userId: user.id, expires: Date.now() + config.challengeMs };
      await save(req);
      res.redirect(config.origin);
    } catch (error) {
      await destroy(req);
      const code = ['UNIVERSITY_ACCOUNT_REQUIRED', 'ACCOUNT_LINK_REQUIRED', 'ACCOUNT_DISABLED'].includes(error.code) ? error.code : 'MICROSOFT_LOGIN_FAILED';
      const allowedReasons = ['TENANT_MISMATCH', 'OBJECT_ID_MISSING', 'MEMBER_CLAIM_MISSING', 'MEMBER_ACCOUNT_REQUIRED', 'UNIVERSITY_DOMAIN_REQUIRED'];
      const reason = code === 'UNIVERSITY_ACCOUNT_REQUIRED' && allowedReasons.includes(error.reason) ? error.reason : null;
      // Only a fixed reason code: never log claims, emails, tokens or callback parameters.
      console.warn('Microsoft login rejected:', reason || code);
      const query = new URLSearchParams({ auth_error: code, ...(reason ? { auth_reason: reason } : {}) });
      res.redirect(`${config.origin}/?${query}`);
    }
  });
  router.post('/2fa/setup', unavailable, csrf, pending, factorLimit, async (req, res) => {
    const user = await repo.findUser(req.session.pending.userId);
    if (!user) return res.status(403).json({ error: 'Account is unavailable' });
    if (user.two_factor_enabled) return res.status(409).json({ error: 'Second factor is already configured' });
    if (!req.session.enrollment) req.session.enrollment = encrypt(generateSecret(), config.key);
    const secret = decrypt(req.session.enrollment, config.key);
    const uri = generateURI({ issuer: 'BookAITU', label: user.email, secret });
    res.json({ secret, qrCode: await QRCode.toDataURL(uri, { width: 240, margin: 2 }) });
  });
  async function finishFactor(req, res, enrollment) {
    const code = req.body?.code;
    if (typeof code !== 'string' || code.length > 80 || (enrollment && !req.session.enrollment)) return res.status(400).json({ error: 'Valid second factor is required' });
    const result = await repo.secondFactor(req.session.pending.userId, { code,
      ...(enrollment ? { enrollmentSecret: decrypt(req.session.enrollment, config.key) } : {}) });
    if (!result.ok) return res.status(result.status).json({ error: result.code === 'SECOND_FACTOR_LOCKED' ? 'Too many attempts. Try again in 15 minutes.' : 'Invalid or already used code', code: result.code });
    await regenerate(req);
    req.session.userId = result.user.id; req.session.authenticatedAt = Date.now(); req.session.csrf = token();
    req.session.cookie.maxAge = config.sessionMs;
    await save(req);
    res.json({ status: 'authenticated', user: result.user, csrfToken: req.session.csrf, ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}) });
  }
  router.post('/2fa/confirm', unavailable, csrf, pending, factorLimit, (req, res) => finishFactor(req, res, true));
  router.post('/2fa/verify', unavailable, csrf, pending, factorLimit, (req, res) => finishFactor(req, res, false));
  router.post('/logout', csrf, async (req, res) => {
    await destroy(req);
    res.clearCookie(config.cookieName, { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' });
    res.status(204).end();
  });
  async function requireAuth(req, res, next) {
    if (!req.session?.userId || !(req.session.authenticatedAt > Date.now() - config.sessionMs)) return res.status(401).json({ error: 'Complete Microsoft login and second factor', code: 'AUTH_REQUIRED' });
    const user = await repo.findUser(req.session.userId);
    if (!user?.two_factor_enabled) { await destroy(req); return res.status(401).json({ error: 'Session is no longer valid', code: 'AUTH_REQUIRED' }); }
    req.user = user; next();
  }
  const requireAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Administrator access required' });
  return { config, router, sessionMiddleware, csrf, requireAuth, requireAdmin, store };
}
module.exports = { createAuth };
