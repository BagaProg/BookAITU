import { useEffect, useState } from 'react';
import { request } from '../api/client';
const empty = {room_id:'',kind:'class',title:'',starts_at:'',ends_at:''};
const kinds = {class:'Занятие',closure:'Закрытие',coverage:'Проверенный период'};
const local = value => new Date(Date.parse(value)+18000000).toISOString().slice(0,16);
const display = value => new Date(value).toLocaleString('ru-RU',{timeZone:'Asia/Qyzylorda',dateStyle:'short',timeStyle:'short'});
export default function Schedules() {
 const [source,setSource]=useState(null),[entries,setEntries]=useState([]),[rooms,setRooms]=useState([]);
 const [form,setForm]=useState(empty),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [ruleRoom,setRuleRoom]=useState(''),[rules,setRules]=useState(''),[allowed,setAllowed]=useState(true);
 const load=()=>Promise.all([request('/api/admin/schedules'),request('/api/admin/schedules/rooms'),request('/api/admin/schedules/source')]).then(([e,r,s])=>{setEntries(e);setRooms(r);setSource(s)});
 useEffect(()=>{let active=true;load().catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
 async function run(work,reset=false){if(busy)return;setBusy(true);setError('');setNotice('');try{await work();await load();if(reset)setForm(empty);setNotice('Изменения сохранены и записаны в журнал.')}catch(e){setError(e.message)}finally{setBusy(false)}}
 const field=(key,value)=>setForm(old=>({...old,[key]:value}));
 const chooseRules=value=>{setRuleRoom(value);const room=rooms.find(r=>String(r.id)===value);setRules(room?.access_rules||'');setAllowed(room?.student_access??true)};
 const options=<><option value="">Выберите кабинет</option>{rooms.map(r=><option key={r.id} value={r.id}>{r.code}</option>)}</>;
 function submit(e){e.preventDefault();if(form.ends_at<=form.starts_at){setError('Конец должен быть позже начала.');return}run(()=>request(`/api/admin/schedules${form.id?'/'+form.id:''}`,{method:form.id?'PUT':'POST',body:JSON.stringify({...form,starts_at:form.starts_at+'+05:00',ends_at:form.ends_at+'+05:00'})}),true)}
 return <div className="schedule-page">
 <div className="schedule-intro"><div><span className="schedule-eyebrow">УПРАВЛЕНИЕ ДОСТУПНОСТЬЮ</span><h2>Расписания и закрытия</h2><p>Занятия, ограничения и проверенные периоды для каждого кабинета.</p></div><span className="schedule-timezone">Астана · UTC+5</span></div>
 {error&&<p role="alert" className="admin-error">{error}</p>}{notice&&<p role="status" className="schedule-success">{notice}</p>}{loading&&<p role="status">Загружаем расписание…</p>}
 <div className="schedule-columns"><section className="admin-section"><h3>{form.id?'Редактировать запись':'Новая запись'}</h3>
 <form className="schedule-form" onSubmit={submit}><fieldset disabled={busy||loading}>
 <label>Кабинет<select required value={form.room_id} onChange={e=>field('room_id',e.target.value)}>{options}</select></label>
 <label>Тип записи<select value={form.kind} onChange={e=>field('kind',e.target.value)}>{Object.entries(kinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <label className="schedule-span">Название<input required maxLength={200} placeholder="Предмет или причина закрытия" value={form.title} onChange={e=>field('title',e.target.value)}/></label>
 <label>Начало<input required type="datetime-local" value={form.starts_at} onChange={e=>field('starts_at',e.target.value)}/></label>
 <label>Конец<input required type="datetime-local" min={form.starts_at} value={form.ends_at} onChange={e=>field('ends_at',e.target.value)}/></label>
 {form.kind==='coverage'&&<p className="schedule-hint schedule-span">Подтверждайте период только после проверки расписаний всех групп. Отсутствие занятий одной группы не подтверждает свободу кабинета.</p>}
 <div className="schedule-buttons schedule-span"><button className="admin-primary" type="submit">{busy?'Сохраняем…':'Сохранить запись'}</button><button type="button" onClick={()=>setForm(empty)}>Сбросить</button></div>
 </fieldset></form></section>
 <section className="admin-section"><h3>Правила доступа</h3><p className="schedule-hint">Ограничения действуют независимо от расписания.</p><form className="schedule-form" onSubmit={e=>{e.preventDefault();run(()=>request('/api/admin/schedules/rules/'+ruleRoom,{method:'PUT',body:JSON.stringify({access_rules:rules,student_access:allowed})}))}}><fieldset disabled={busy||loading} className="schedule-single">
 <label>Кабинет<select required value={ruleRoom} onChange={e=>chooseRules(e.target.value)}>{options}</select></label>
 <label>Условия доступа<textarea rows={4} maxLength={2000} placeholder="Например: требуется разрешение сотрудника" value={rules} onChange={e=>setRules(e.target.value)}/></label>
 <label className="schedule-check"><input type="checkbox" checked={allowed} onChange={e=>setAllowed(e.target.checked)}/>Доступ студентам</label>
 <button className="admin-primary" disabled={!ruleRoom} type="submit">Сохранить правила</button>
 </fieldset></form></section></div>
 <section className="admin-section"><div className="schedule-list-heading"><h3>Записи расписания</h3><span>Всего: {entries.length}</span></div>
 {!loading&&!entries.length&&<div className="schedule-empty">Записей с календарными датами пока нет. Добавьте занятие или закрытие с помощью формы выше.</div>}
 <div className="schedule-entry-list">{entries.map(e=><article key={e.id} className="schedule-entry"><div><span className={`schedule-kind ${e.kind}`}>{kinds[e.kind]}</span><h4>{e.code} · {e.title}</h4><p>{display(e.starts_at)} — {display(e.ends_at)}</p></div><div className="schedule-buttons"><button disabled={busy} onClick={()=>{setForm({...e,starts_at:local(e.starts_at),ends_at:local(e.ends_at)});window.scrollTo({top:0,behavior:'smooth'})}}>Изменить</button><button className="schedule-delete" disabled={busy} onClick={()=>{if(window.confirm('Удалить запись '+e.title+'?'))run(()=>request('/api/admin/schedules/'+e.id,{method:'DELETE'}))}}>Удалить</button></div></article>)}</div></section>
 <details className="admin-section schedule-source"><summary>Исходные данные · неделя 8</summary><p className="schedule-hint">Расписание одной группы без календарных дат. Эти сведения не подтверждают свободное время кабинетов.</p><div className="schedule-source-grid">{source?.entries.map((e,i)=><div key={i}><strong>{e.room_code}</strong><span>{e.weekday?['','Пн','Вт','Ср','Чт','Пт','Сб'][e.weekday]:'День не указан'} · {e.start}–{e.end}</span></div>)}</div></details>
 </div>;
}
