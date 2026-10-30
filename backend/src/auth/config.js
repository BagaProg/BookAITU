const crypto = require('node:crypto');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function getConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.FRONTEND_ORIGIN || env.RENDER_EXTERNAL_URL || 'http://localhost:5173';
  const redirectUri = env.MICROSOFT_REDIRECT_URI || (env.RENDER_EXTERNAL_URL ? `${origin}/api/auth/microsoft/callback` : 'http://localhost:3001/api/auth/microsoft/callback');
  const tenant = (env.MICROSOFT_TENANT_ID || '').toLowerCase();
  const clientId = env.MICROSOFT_CLIENT_ID || '';
  const domains = (env.UNIVERSITY_EMAIL_DOMAINS || 'astanait.edu.kz').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const key = Buffer.from(env.AUTH_ENCRYPTION_KEY || '', 'base64');
  const secret = env.SESSION_SECRET || '';
  const missing = [];
  if (!uuid.test(tenant) || tenant === '9188040d-6c67-4c5b-b112-36a304b66dad') missing.push('MICROSOFT_TENANT_ID');
  if (!uuid.test(clientId)) missing.push('MICROSOFT_CLIENT_ID');
  if (!env.MICROSOFT_CLIENT_SECRET) missing.push('MICROSOFT_CLIENT_SECRET');
  if (key.length !== 32) missing.push('AUTH_ENCRYPTION_KEY');
  if (secret.length < 32) missing.push('SESSION_SECRET');
  if (env.PG_ALLOW_WRITE !== 'true') missing.push('PG_ALLOW_WRITE');
  for (const value of [origin, redirectUri]) {
    const url = new URL(value);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
      throw new Error('Auth URLs require HTTPS, except local development');
    }
  }
  if (new URL(origin).origin !== origin || !domains.length || domains.some(d => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) throw new Error('Invalid auth origin or university domains');
  if (production && missing.length) throw new Error('Authentication configuration is incomplete');
  return { production, origin, redirectUri, tenant, clientId, clientSecret: env.MICROSOFT_CLIENT_SECRET, domains, key, secret,
    configured: missing.length === 0, missing, cookieName: production ? '__Host-bookaitu.sid' : 'bookaitu.sid',
    challengeMs: 10 * 60 * 1000, sessionMs: 8 * 60 * 60 * 1000 };
}

function validateIdentity(claims, config) {
  // Called only after OIDC signature, issuer, audience, state and nonce validation.
  const reject = reason => { throw Object.assign(new Error('University member account required'), { code: 'UNIVERSITY_ACCOUNT_REQUIRED', reason }); };
  if (!claims || typeof claims.tid !== 'string' || claims.tid.toLowerCase() !== config.tenant) reject('TENANT_MISMATCH');
  if (!uuid.test(claims.oid || '')) reject('OBJECT_ID_MISSING');
  if (claims.acct == null) reject('MEMBER_CLAIM_MISSING');
  if (![0, '0'].includes(claims.acct)) reject('MEMBER_ACCOUNT_REQUIRED');
  const email = String(claims.preferred_username || claims.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !config.domains.includes(email.split('@')[1]) || email.includes('#ext#') || email.length > 255) {
    reject('UNIVERSITY_DOMAIN_REQUIRED');
  }
  return { microsoftId: `${config.tenant}:${claims.oid.toLowerCase()}`, email, name: String(claims.name || email.split('@')[0]).slice(0, 100) };
}

const token = () => crypto.randomBytes(32).toString('base64url');
function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
    && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
module.exports = { getConfig, validateIdentity, token, equal };
