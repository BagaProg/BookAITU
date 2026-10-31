const router = require('express').Router();
const pool = require('../db');
const { validateBooking } = require('../bookingValidation');
const { evaluate } = require('../availability');
router.get('/availability', async (req,res) => {
 const {date,start,end}=req.query;
 const error=validateBooking({user_id:'1',room_id:'1',booking_date:date,start_time:start,end_time:end,purpose:'Search'});
 if(error) return res.status(400).json({error});
 const from=`${date}T${start}+05:00`, to=`${date}T${end}+05:00`;
 const {rows:rooms}=await pool.query('SELECT * FROM rooms ORDER BY block,floor,number');
 const {rows:events}=await pool.query('SELECT * FROM room_events WHERE ends_at>$1::timestamptz ORDER BY starts_at',[from]);
 const {rows:bookings}=await pool.query("SELECT DISTINCT room_id FROM bookings WHERE booking_date=$1 AND status<>'cancelled' AND start_time<$3::time AND end_time>$2::time",[date,start,end]);
 res.set('Cache-Control','no-store');
 res.json({checkedAt:new Date().toISOString(),rooms:rooms.map(room=>{
  const own=events.filter(e=>String(e.room_id)===String(room.id));
  return {...room,...evaluate(room,own,Date.parse(from),Date.parse(to),bookings.some(b=>String(b.room_id)===String(room.id))),next_class:own.find(e=>e.kind==='class' && Date.parse(e.starts_at)>=Date.parse(from))||null,schedule_updated_at:own.reduce((latest,e)=>!latest||Date.parse(e.updated_at)>Date.parse(latest)?e.updated_at:latest,null)};
 })});
});
router.get('/',async(req,res)=>res.json((await pool.query('SELECT id,COALESCE(name,code) AS name,block,floor,number,code,room_type,capacity,access_rules,student_access,details_updated_at FROM rooms WHERE is_active ORDER BY block,floor,number')).rows));
module.exports=router;
