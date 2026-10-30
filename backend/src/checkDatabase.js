require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const { Client } = require('pg');

const queries = {
  database: 'SELECT current_database() AS database',
  schemas: "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema'",
  columns: "SELECT table_schema,table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name,ordinal_position",
  constraints: "SELECT conrelid::regclass AS table_name,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace",
  indexes: "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'",
  counts: 'SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM rooms) AS rooms,(SELECT count(*) FROM bookings) AS bookings',
  integrity: 'SELECT count(*) AS orphan_bookings FROM bookings b LEFT JOIN users u ON u.id=b.user_id LEFT JOIN rooms r ON r.id=b.room_id WHERE u.id IS NULL OR r.id IS NULL',
  overlaps: "SELECT count(*) AS overlapping_pairs FROM bookings a JOIN bookings b ON a.id<b.id AND a.room_id=b.room_id AND a.booking_date=b.booking_date AND a.start_time<b.end_time AND a.end_time>b.start_time WHERE a.status <> 'cancelled' AND b.status <> 'cancelled'",
};

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    for (const [name, sql] of Object.entries(queries)) {
      console.log(name, JSON.stringify((await client.query(sql)).rows));
    }
    await client.query('ROLLBACK');
  } catch (error) {
    console.error('Database check failed:', error.code || error.name);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
