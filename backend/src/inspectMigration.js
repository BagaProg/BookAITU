const pool = require('./db');
(async () => {
  try {
    for (const [label, sql] of Object.entries({
      database: 'SELECT current_database() AS database',
      columns: "SELECT table_name,column_name,data_type,character_maximum_length,is_nullable,is_identity,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
      rooms: 'SELECT id,code,name,block,floor,number,capacity,is_active FROM public.rooms ORDER BY id',
      counts: 'SELECT (SELECT count(*) FROM public.users) AS users,(SELECT count(*) FROM public.rooms) AS rooms,(SELECT count(*) FROM public.bookings) AS bookings',
      constraints: "SELECT conrelid::regclass AS table_name,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace",
      timezone: 'SHOW timezone',
      triggers: "SELECT event_object_table,trigger_name FROM information_schema.triggers WHERE trigger_schema='public'",
    })) console.log(label, JSON.stringify((await pool.query(sql)).rows));
  } catch (e) { console.error(e.code || e.name); process.exitCode = 1; }
  finally { await pool.end(); }
})();
