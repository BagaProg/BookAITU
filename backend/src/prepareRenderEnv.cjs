// Generates a gitignored Render import file without printing credentials.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { getConfig } = require('./auth/config');
const directory = path.resolve(__dirname, '..');
const source = dotenv.parse(fs.readFileSync(path.join(directory, '.env')));
const required = ['DATABASE_URL', 'SESSION_SECRET', 'AUTH_ENCRYPTION_KEY', 'MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'];
for (const key of required) if (!source[key]) throw new Error(`Missing ${key}`);
if (!new URL(source.DATABASE_URL).hostname.endsWith('.neon.tech')) throw new Error('Expected the migrated Neon database');
const env = Object.fromEntries(required.map(key => [key, source[key]]));
Object.assign(env, { NODE_ENV: 'production', NODE_VERSION: '24.18.0', HOST: '0.0.0.0', TRUST_PROXY: '1', SERVE_FRONTEND: 'true', PG_ALLOW_WRITE: 'true', UNIVERSITY_EMAIL_DOMAINS: source.UNIVERSITY_EMAIL_DOMAINS || 'astanait.edu.kz', VITE_API_URL: '' });
// Render injects its real URL at runtime; do not retain local callback/origin/port.
getConfig({ ...env, RENDER_EXTERNAL_URL: 'https://configuration-check.onrender.com' });
fs.writeFileSync(path.join(directory, '.env.render'), Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
console.log('Created backend/.env.render; values were not printed. File must remain gitignored.');
