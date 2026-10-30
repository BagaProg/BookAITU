const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
const local = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')));
const target = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env.neon'))).NEON_DATABASE_URL;
const sourceUrl = new URL(local.DATABASE_URL);
assert(['localhost', '127.0.0.1'].includes(sourceUrl.hostname), 'Source must be local');
assert(new URL(target).hostname.endsWith('.neon.tech'), 'Target must be Neon');
assert(!new URL(target).hostname.includes('-pooler.'), 'Restore requires direct connection');
const folder = path.join(root, 'database/backups');
fs.mkdirSync(folder, { recursive: true });
const dump = path.join(folder, 'neon-transfer.dump');
const manifest = path.join(folder, 'neon-transfer.json');
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
function pg(tool, connectionString, args) {
  const u = new URL(connectionString);
  const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGCONNECT_TIMEOUT: '15', PGSSLMODE: u.searchParams.get('sslmode') || (u.hostname.endsWith('.neon.tech') ? 'require' : 'prefer') };
  const result = spawnSync(path.join(bin, tool + '.exe'), args, { env, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(tool + ' failed: ' + (result.error?.code || result.stderr));
}
async function inspect(connectionString) {
  const c = new Client({ connectionString, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    await c.query("SET TIME ZONE 'UTC'");
    const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const result = {};
    for (const { tablename } of tables) {
      if (tablename === 'auth_sessions') continue;
      const name = '"' + tablename.replaceAll('"', '""') + '"';
      result[tablename] = (await c.query(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(row_data, E'\\n' ORDER BY row_data), '')) AS checksum FROM (SELECT row_to_json(t)::text AS row_data FROM public.${name} t) s`)).rows[0];
    }
    return result;
  } finally { await c.end(); }
}
(async () => {
  if (process.argv.includes('--export')) {
    const before = await inspect(local.DATABASE_URL);
    pg('pg_dump', local.DATABASE_URL, ['--format=custom', '--no-owner', '--no-acl', '--exclude-table-data=public.auth_sessions', '--file', dump]);
    pg('pg_restore', local.DATABASE_URL, ['--list', dump]);
    assert.deepEqual(await inspect(local.DATABASE_URL), before, 'Source changed during export; retry');
    fs.writeFileSync(manifest, JSON.stringify(before, null, 2));
    console.log('Fresh export verified:', JSON.stringify(before));
  } else if (process.argv.includes('--import')) {
    const c = new Client({ connectionString: target, connectionTimeoutMillis: 15000 });
    try { await c.connect(); assert.equal((await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, 'Target must be empty'); } finally { await c.end(); }
    pg('pg_restore', target, ['--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', '--dbname', new URL(target).pathname.slice(1), dump]);
    const actual = await inspect(target);
    assert.deepEqual(actual, JSON.parse(fs.readFileSync(manifest, 'utf8')), 'Restored data must match export');
    console.log('Neon import verified:', JSON.stringify(actual));
  } else throw new Error('Use --export or --import');
})().catch(e => { console.error(e.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[REDACTED]')); process.exitCode = 1; });
