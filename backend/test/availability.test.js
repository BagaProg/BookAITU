const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluate}=require('../src/availability');
const room={is_active:true,student_access:true};
const t=h=>Date.parse(`2026-10-26T${h}:00+05:00`);
const event=(kind,a,b)=>({kind,title:kind,starts_at:new Date(t(a)).toISOString(),ends_at:new Date(t(b)).toISOString()});
const cases=[
 ['missing timetable',[],false,room,'unknown'],
 ['complete timetable',[event('coverage','09:00','12:00')],false,room,'available'],
 ['partial timetable',[event('coverage','10:00','10:30')],false,room,'unknown'],
 ['class overlap',[event('class','10:30','11:30')],false,room,'occupied'],
 ['class ends at start',[event('class','09:00','10:00'),event('coverage','10:00','11:00')],false,room,'available'],
 ['class starts at end',[event('class','11:00','12:00'),event('coverage','10:00','11:00')],false,room,'available'],
 ['closure',[event('closure','10:00','11:00')],false,room,'unavailable'],
 ['reservation',[],true,room,'occupied'],
 ['staff only',[],false,{...room,student_access:false},'unavailable'],
 ['adjacent coverage',[event('coverage','10:00','10:30'),event('coverage','10:30','11:00')],false,room,'available'],
 ['gap in coverage',[event('coverage','10:00','10:20'),event('coverage','10:30','11:00')],false,room,'unknown'],
];
for(const [name,events,booked,r,status] of cases)test(name,()=>assert.equal(evaluate(r,events,t('10:00'),t('11:00'),booked).availability,status));
