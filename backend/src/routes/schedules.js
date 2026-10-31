const router = require('express').Router();
const pool = require('../db');
const { validId } = require('../bookingValidation');
const { adminTransaction, audit, fail } = require('../admin/service');
const reject = message => { throw fail(400, message); };
const id = value => { if (!validId(value)) reject('Invalid id'); return value; };
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/source', (req,res)=>res.json(require('../scheduleSource.json')));
router.get('/rooms',async(req,res)=>res.json((await pool.query('SELECT id,code,access_rules,student_access FROM rooms ORDER BY code')).rows));
router.get('/',async(req,res)=>res.json((await pool.query('SELECT e.*,r.code FROM room_events e JOIN rooms r ON r.id=e.room_id ORDER BY starts_at DESC,e.id DESC LIMIT 1000')).rows));
router.use((req,res,next)=>process.env.PG_ALLOW_WRITE==='true'?next():res.status(403).json({error:'Database writes are disabled'}));
router.put('/rules/:id',async(req,res)=>{
 const roomId=id(req.params.id), {access_rules,student_access}=req.body || {};
 if(typeof access_rules!=='string'||access_rules.length>2000||typeof student_access!=='boolean') reject('Invalid access rules');
 const result=await adminTransaction(req.user.id,async(client,actor)=>{
  const before=(await client.query('SELECT id,code,access_rules,student_access FROM rooms WHERE id=$1 FOR UPDATE',[roomId])).rows[0];
  if(!before) throw fail(404,'Room not found');
  const after=(await client.query('UPDATE rooms SET access_rules=$1,student_access=$2,details_updated_at=now() WHERE id=$3 RETURNING id,code,access_rules,student_access',[access_rules.trim(),student_access,roomId])).rows[0];
  await audit(client,actor,'room.access.update','room',roomId,before,after);
  return after;
 });res.json(result);
});
const validInstant=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
async function save(req,res){
 const b=req.body || {}; id(b.room_id); if(req.params.id) id(req.params.id);
 if(!['class','closure','coverage'].includes(b.kind)||typeof b.title!=='string'||!b.title.trim()||b.title.length>200||!validInstant(b.starts_at)||!validInstant(b.ends_at)||Date.parse(b.ends_at)<=Date.parse(b.starts_at)) reject('Check the title and date interval');
 const result=await adminTransaction(req.user.id,async(client,actor)=>{
  const before=req.params.id?(await client.query('SELECT * FROM room_events WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0]:null;
  if(req.params.id&&!before) throw fail(404,'Entry not found');
  const ids=[...new Set([String(b.room_id), ...(before?[String(before.room_id)]:[])])].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
  for(const roomId of ids){const room=await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE',[roomId]);if(!room.rowCount)throw fail(404,'Room not found');}
  const values=[b.room_id,b.kind,b.title.trim(),new Date(b.starts_at),new Date(b.ends_at)];
  const after=(req.params.id?await client.query('UPDATE room_events SET room_id=$1,kind=$2,title=$3,starts_at=$4,ends_at=$5,updated_at=now() WHERE id=$6 RETURNING *',[...values,req.params.id]):await client.query('INSERT INTO room_events(room_id,kind,title,starts_at,ends_at) VALUES($1,$2,$3,$4,$5) RETURNING *',values)).rows[0];
  await audit(client,actor,req.params.id?'schedule.update':'schedule.create','room',b.room_id,before||{},after);
  return after;
 });res.status(req.params.id?200:201).json(result);
}
router.post('/',save);router.put('/:id',save);
router.delete('/:id',async(req,res)=>{
 const eventId=id(req.params.id);
 await adminTransaction(req.user.id,async(client,actor)=>{
  const before=(await client.query('SELECT * FROM room_events WHERE id=$1 FOR UPDATE',[eventId])).rows[0];
  if(!before)throw fail(404,'Entry not found');
  await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE',[before.room_id]);
  await client.query('DELETE FROM room_events WHERE id=$1',[eventId]);
  await audit(client,actor,'schedule.delete','room',before.room_id,before,{});
 });res.status(204).end();
});
module.exports=router;
