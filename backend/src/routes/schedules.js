const router = require('express').Router();
const pool = require('../db');
const { validId } = require('../bookingValidation');
router.get('/source', (req,res)=>res.json(require('../scheduleSource.json')));
router.get('/rooms',async(req,res)=>res.json((await pool.query('SELECT id,code,access_rules,student_access FROM rooms ORDER BY code')).rows));
router.get('/',async(req,res)=>res.json((await pool.query('SELECT e.*,r.code FROM room_events e JOIN rooms r ON r.id=e.room_id ORDER BY starts_at DESC LIMIT 1000')).rows));
router.use((req,res,next)=>process.env.PG_ALLOW_WRITE==='true'?next():res.status(403).json({error:'Database writes are disabled'}));
router.put('/rules/:id',async(req,res)=>{
 const {access_rules,student_access}=req.body;
 if(!validId(req.params.id)||typeof access_rules!=='string'||access_rules.length>2000||typeof student_access!=='boolean') return res.status(400).json({error:'Invalid access rules'});
 const result=await pool.query('UPDATE rooms SET access_rules=$1,student_access=$2,details_updated_at=now() WHERE id=$3 RETURNING id',[access_rules,student_access,req.params.id]);
 res.status(result.rowCount?200:404).json({saved:!!result.rowCount});
});
async function save(req,res) {
 const b=req.body;
 if(!validId(b.room_id)||!['class','closure','coverage'].includes(b.kind)||typeof b.title!=='string'||!b.title.trim()||b.title.length>200||!Number.isFinite(Date.parse(b.starts_at))||!Number.isFinite(Date.parse(b.ends_at))||Date.parse(b.ends_at)<=Date.parse(b.starts_at)|| (req.params.id&&!validId(req.params.id))) return res.status(400).json({error:'Invalid schedule entry'});
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const room=await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE',[b.room_id]);
  if(!room.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Room not found'});}
  const values=[b.room_id,b.kind,b.title.trim(),new Date(b.starts_at),new Date(b.ends_at)];
  const result=req.params.id?await client.query('UPDATE room_events SET room_id=$1,kind=$2,title=$3,starts_at=$4,ends_at=$5,updated_at=now() WHERE id=$6 RETURNING *',[...values,req.params.id]):await client.query('INSERT INTO room_events(room_id,kind,title,starts_at,ends_at) VALUES($1,$2,$3,$4,$5) RETURNING *',values);
  await client.query('COMMIT');res.status(result.rowCount?200:404).json(result.rows[0]||{error:'Entry not found'});
 } catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
router.post('/',save);router.put('/:id',save);
router.delete('/:id',async(req,res)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Invalid id'});
 const result=await pool.query('DELETE FROM room_events WHERE id=$1 RETURNING id',[req.params.id]);
 res.status(result.rowCount?204:404).end();
});
module.exports=router;
