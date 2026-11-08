const { evaluate } = require('../src/availability');
const { validateBooking } = require('../src/bookingValidation');
const test = require('node:test');
const assert = require('node:assert/strict');
const start=Date.parse('2099-10-23T10:00:00+05:00'), end=start+3600000;
for (const room of [{is_active:true,student_access:false},{is_active:false,student_access:true}]) {
 test(`yellow room ${JSON.stringify(room)} is administrator only`,()=>{
  assert.equal(evaluate(room,[],start,end,false,'user').bookable,false);
  const admin=evaluate(room,[],start,end,false,'admin');
  assert.equal(admin.availability,'unavailable'); assert.equal(admin.bookable,true);
  assert.equal(evaluate(room,[],start,end,true,'admin').bookable,false);
  assert.equal(evaluate(room,[{kind:'class',starts_at:new Date(start).toISOString(),ends_at:new Date(end).toISOString()}],start,end,false,'admin').bookable,false);
 });
}
const valid={user_id:'1',room_id:'1',booking_date:'2099-10-23',purpose:'Study'};
for(const [a,b,ok] of [['08:00','22:00',true],['08:00:00','22:00:00',true],['07:59','09:00',false],['21:00','22:01',false],['21:00:00','22:00:01',false],['22:00','22:00',false]]) test(`hours ${a}–${b}`,()=>assert.equal(validateBooking({...valid,start_time:a,end_time:b})===null,ok));
