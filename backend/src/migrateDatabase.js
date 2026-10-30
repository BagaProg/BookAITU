const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const pool = require('./db');

const root = path.resolve(__dirname, '../..');
const migrations = ['001_users_rooms_auth.sql', '002_campus_rooms.sql', '003_clear_bookings_remove_legacy_rooms.sql', '004_trim_room_zones.sql', '005_auth_sessions.sql', '006_admin_panel.sql', '007_confirm_bookings.sql'];
const apply = process.argv.includes('--apply');
const allowBookingCleanup = process.argv.includes('--allow-booking-cleanup');
const allowRoomPruning = process.argv.includes('--allow-room-pruning');
if (!apply && !process.argv.includes('--dry-run')) throw new Error('Use --dry-run or --apply');

function backupDatabase() {
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || decodeURIComponent(url.pathname) !== '/BookAITU') {
    throw new Error('Only local BookAITU is allowed');
  }
  const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
  const directory = path.join(root, 'database/backups');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `BookAITU_${new Date().toISOString().replace(/[:.]/g, '-')}_${crypto.randomUUID()}.dump`);
  const args = ['--host', url.hostname, '--port', url.port || '5432', '--username', decodeURIComponent(url.username), '--dbname', 'BookAITU', '--no-password', '--format=custom', '--file', file];
  const result = spawnSync(path.join(bin, 'pg_dump.exe'), args, {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '5' },
    encoding: 'utf8', timeout: 60000,
  });
  if (result.status !== 0 || !fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error('Backup failed; migration stopped');
  const verify = spawnSync(path.join(bin, 'pg_restore.exe'), ['--file', process.platform === 'win32' ? 'NUL' : '/dev/null', file], { encoding: 'utf8', timeout: 60000 });
  if (verify.status !== 0) throw new Error('Backup archive verification failed; migration stopped');
  console.log('Verified backup:', path.relative(root, file));
  console.log('Backup SHA256:', crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
}

async function snapshot(client) {
  return {
    users: (await client.query('SELECT id::text,email,password_hash,role FROM public.users ORDER BY id')).rows,
    rooms: (await client.query("SELECT id::text, to_jsonb(r) - 'building' AS data FROM public.rooms r ORDER BY id")).rows,
    bookings: (await client.query('SELECT * FROM public.bookings ORDER BY id')).rows,
  };
}

(async () => {
  let client;
  try {
    if (process.env.PG_ALLOW_WRITE !== 'true') throw new Error('PG_ALLOW_WRITE=true is required');
    client = await pool.connect();
    assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, 'BookAITU');
    backupDatabase();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query('SELECT pg_advisory_xact_lock(20261023, 1)');
    await client.query('LOCK TABLE public.users, public.rooms, public.bookings IN ACCESS EXCLUSIVE MODE');
    const before = await snapshot(client);
    let inventoryApplied = false;
    let bookingStatusesUpdated = false;
    let cleanupApplied = false;
    let roomPruningApplied = false;
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const name of migrations) {
      const sql = fs.readFileSync(path.join(root, 'database/migrations', name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const prior = (await client.query('SELECT checksum FROM public.schema_migrations WHERE name=$1', [name])).rows[0];
      if (prior) { assert.equal(prior.checksum, checksum, `Applied migration changed: ${name}`); continue; }
      if (name === '003_clear_bookings_remove_legacy_rooms.sql') {
        if (!allowBookingCleanup) throw Object.assign(new Error('Explicit booking cleanup flag required'), { code: 'CLEANUP_OPT_IN_REQUIRED' });
        console.log('Approved cleanup scope: bookings', before.bookings.length, 'legacy rooms', before.rooms.filter(row => row.data.block == null && row.data.number == null && !row.data.is_active).length, 'column: rooms.building');
        cleanupApplied = true;
      }
      if (name === '004_trim_room_zones.sql') {
        if (!allowRoomPruning) throw Object.assign(new Error('Explicit room pruning flag required'), { code: 'ROOM_PRUNING_OPT_IN_REQUIRED' });
        console.log('Approved room pruning scope:', before.rooms.filter(row => !['room', 'hall', 'open_space', 'coworking'].includes(row.data.room_type)).length, 'zones; column: rooms.created_at; rename coworking to Atameken Space');
        roomPruningApplied = true;
      }
      await client.query(sql);
      if (name === '002_campus_rooms.sql') inventoryApplied = true;
      if (name === '007_confirm_bookings.sql') bookingStatusesUpdated = true;
      await client.query('INSERT INTO public.schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
      console.log('Validated migration:', name);
    }
    const after = await snapshot(client);
    // pg represents bigint as strings; compare ids without changing any data.
    const normalize = rows => JSON.parse(JSON.stringify(rows.map(row => Object.fromEntries(Object.entries(row)
      .filter(([key, value]) => !(['cancelled_at', 'cancelled_by', 'cancellation_reason'].includes(key) && value === null)))),
    (key, value) => ['id', 'user_id', 'room_id'].includes(key) ? String(value) : value));
    assert.deepEqual(after.users, before.users, 'Existing users must be preserved');
    if (cleanupApplied) {
      assert.equal(after.bookings.length, 0, 'Bookings must be empty after approved cleanup');
    } else {
      assert.deepEqual(normalize(after.bookings), normalize(before.bookings.map(row => bookingStatusesUpdated && row.status === 'pending' ? { ...row, status: 'confirmed' } : row)), 'Existing bookings must be preserved except approved status confirmation');
    }
    if (roomPruningApplied || cleanupApplied) {
      const expectedRooms = before.rooms.filter(row =>
        !(cleanupApplied && row.data.block == null && row.data.number == null && !row.data.is_active)
        && !(roomPruningApplied && !['room', 'hall', 'open_space', 'coworking'].includes(row.data.room_type))
      ).map(row => {
        const data = { ...row.data };
        if (roomPruningApplied) {
          delete data.created_at;
          if (data.block === 'C1.2' && data.number === 'COWORKING' && data.room_type === 'coworking') {
            data.number = 'ATAMEKEN_SPACE'; data.name = 'Atameken Space'; data.code = 'C1.2.ATAMEKEN_SPACE';
          }
        }
        return { ...row, data };
      });
      assert.deepEqual(after.rooms, expectedRooms, 'Only explicitly approved room changes may be applied');
    } else {
      // Earlier additive migrations introduce room fields; preserve their original labels.
      for (const room of before.rooms) {
        const retained = after.rooms.find(row => row.id === room.id);
        assert.ok(retained);
        for (const key of ['name', 'capacity']) assert.deepEqual(retained.data[key], room.data[key]);
      }
    }
    const orphans = await client.query('SELECT count(*)::int AS count FROM public.bookings b LEFT JOIN public.users u ON u.id=b.user_id LEFT JOIN public.rooms r ON r.id=b.room_id WHERE u.id IS NULL OR r.id IS NULL');
    assert.equal(orphans.rows[0].count, 0);
    const groups = (await client.query('SELECT block,floor,count(*)::int AS count FROM public.rooms WHERE is_active GROUP BY block,floor ORDER BY block,floor')).rows;
    if (inventoryApplied) assert.deepEqual(groups, [
      ['C1.1', 1, 13], ['C1.1', 2, 45], ['C1.1', 3, 39],
      ['C1.2', 1, 13], ['C1.2', 2, 29], ['C1.2', 3, 40],
      ['C1.3', 1, 10], ['C1.3', 2, 41], ['C1.3', 3, 34],
    ].map(([block, floor, count]) => ({ block, floor, count })), 'Room inventory must match supplied SQL');
    console.log('Active room inventory:', JSON.stringify(groups));
    console.log('Preserved users:', before.users.length, 'Bookings after migration:', after.bookings.length, 'Rooms after migration:', after.rooms.length, 'Orphans: 0');
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(apply ? 'Migration committed' : 'Dry run passed; all schema/data changes rolled back');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    // Assertion details can contain snapshots with user information.
    console.error('Migration stopped:', error.code || error.name);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
})();
