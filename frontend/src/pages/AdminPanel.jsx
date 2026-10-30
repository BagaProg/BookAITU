import { useEffect, useRef, useState } from 'react';
import { request } from '../api/client';
import './AdminPanel.css';
import { readSearchInterval, saveSearchInterval } from '../api/searchInterval';

const labels = { overview: 'Обзор', bookings: 'Бронирования', rooms: 'Помещения', users: 'Пользователи', audit: 'Журнал действий' };
const statuses = { confirmed: 'Подтверждено', cancelled: 'Отменено' };
const dateTime = value => value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Asia/Qyzylorda' }) : '—';

function Overview() {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { let active = true; request('/api/admin/dashboard').then(result => { if (active) setData(result); }).catch(err => { if (active) setError(err.message); }); return () => { active = false; }; }, []);
  if (error) return <p role="alert" className="admin-error">{error}</p>;
  if (!data) return <p role="status">Загружаем статистику…</p>;
  const m = data.metrics, max = Math.max(1, ...data.upcoming.map(day => day.count));
  return <>
    <div className="admin-stats">{[
      ['Пользователи', m.users_total, `Активны: ${m.users_active} · Администраторы: ${m.admins_active}`],
      ['Помещения', m.rooms_total, `Включены для бронирования: ${m.rooms_active}`],
      ['Брони на сегодня', m.bookings_today, `Дата: ${m.today}`],
      ['Бронирования всего', m.bookings_total, `Без отмены: ${m.bookings_active} · Отменены: ${m.bookings_cancelled}`],
    ].map(([title, count, detail]) => <article className="admin-stat" key={title}><span>{title}</span><strong>{count}</strong><small>{detail}</small></article>)}</div>
    <section className="admin-chart"><h2>Бронирования на ближайшие 7 дней</h2><p>Количество броней без отмены по дате · часовой пояс {data.timezone}</p>
      <div className="admin-bars">{data.upcoming.map(day => <div className="admin-bar-row" key={day.date}><time dateTime={day.date}>{day.date.slice(5)}</time><div className="admin-bar-track"><div style={{ width: `${day.count / max * 100}%` }} /></div><strong>{day.count}</strong></div>)}</div>
      <p className="admin-muted">Источник: текущие записи PostgreSQL. Нулевое значение означает отсутствие бронирований на этот день.</p>
    </section>
    <section className="admin-section"><h2>Статусы за всё время</h2><div className="admin-statuses">{Object.entries(statuses).map(([key, title]) => <span key={key}>{title}: <strong>{data.byStatus.find(row => row.status === key)?.count || 0}</strong></span>)}</div></section>
  </>;
}

function Editor({ type, item, currentUser, onClose, onSaved }) {
  const dialog = useRef(null);
  const [name, setName] = useState(item.name || ''), [capacity, setCapacity] = useState(item.capacity ?? '');
  const [enabled, setEnabled] = useState(item.is_active), [role, setRole] = useState(item.role || 'user');
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current.showModal(); }, []);
  const ownAccount = type === 'users' && String(currentUser.id) === item.id;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = type === 'rooms' ? { name: name.trim() || null, capacity: capacity === '' ? null : Number(capacity), is_active: enabled }
        : type === 'users' ? { role, is_active: enabled } : { reason };
      await request(`/api/admin/${type}/${item.id}${type === 'bookings' ? '/cancel' : ''}`, { method: type === 'bookings' ? 'POST' : 'PATCH', body: JSON.stringify(payload) });
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="admin-dialog" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="editor-heading"><form onSubmit={submit}>
    <h2 id="editor-heading">{type === 'rooms' ? item.code : type === 'users' ? item.email : `Отмена брони №${item.id}`}</h2>
    {error && <p role="alert" className="admin-error">{error}</p>}
    {type === 'rooms' && <>
      <label>Название<input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
      <label>Вместимость<input type="number" min="1" max="2147483647" step="1" value={capacity} onChange={event => setCapacity(event.target.value)} /></label>
      <small>Пустое значение означает, что вместимость неизвестна.</small>
    </>}
    {type === 'users' && <>
      <label>Роль<select value={role} disabled={ownAccount} onChange={event => setRole(event.target.value)}><option value="user">Пользователь</option><option value="admin" disabled={!item.microsoft_linked || !item.two_factor_enabled}>Администратор</option></select></label>
      <small>{ownAccount ? 'Собственный административный доступ отключить нельзя.' : 'Администратору нужны подтверждённый Microsoft-аккаунт и настроенная 2FA. Изменение роли или активности завершит сессии пользователя.'}</small>
    </>}
    {type !== 'bookings' && <label className="admin-check"><input type="checkbox" checked={enabled} disabled={ownAccount} onChange={event => setEnabled(event.target.checked)} />{type === 'rooms' ? 'Помещение включено для бронирования' : 'Аккаунт активен'}</label>}
    {type === 'rooms' && <small>Отключение помещения не отменяет уже существующие брони.</small>}
    {type === 'bookings' && <><p>{item.room_code} · {item.email}<br />{item.booking_date} · {item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}</p><label>Причина отмены<textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label><small>Запись останется в истории. Действие попадёт в журнал администратора.</small></>}
    <div className="admin-actions"><button type="button" onClick={onClose} disabled={busy}>Закрыть</button><button className={type === 'bookings' ? 'admin-danger' : 'admin-primary'} disabled={busy || ownAccount}>{busy ? 'Сохраняем…' : type === 'bookings' ? 'Отменить бронирование' : 'Сохранить'}</button></div>
  </form></dialog>;
}

function Records({ type, user }) {
  const [intervalDraft, setIntervalDraft] = useState(readSearchInterval);
  const [interval, setInterval] = useState(readSearchInterval);
  const [availability, setAvailability] = useState(null);

  const [draft, setDraft] = useState({ q: '', status: '', from: '', to: '', active: '', block: '', role: '' });
  const [filter, setFilter] = useState({}), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [editing, setEditing] = useState(null);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ ...filter, page, limit: 20 });
    Promise.all([
      request(`/api/admin/${type}?${query}`),
      type === 'rooms' ? request(`/api/rooms/availability?${new URLSearchParams(interval)}`) : Promise.resolve(null),
    ]).then(([result, occupancy]) => { if (active) {
      setData(result); setAvailability(occupancy ? Object.fromEntries(occupancy.rooms.map(room => [String(room.id), room.availability])) : null); setError('');
    } })
      .catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [type, filter, page, revision, interval]);
  const field = key => ({ value: draft[key], onChange: event => setDraft({ ...draft, [key]: event.target.value }) });
  function submit(event) { event.preventDefault();
    if (type === 'rooms') {
      if (!intervalDraft.date || !intervalDraft.start || !intervalDraft.end || intervalDraft.start >= intervalDraft.end) { setError('Выберите дату и время окончания позже начала.'); return; }
      setInterval({ ...intervalDraft }); saveSearchInterval(intervalDraft);
    }
    setLoading(true); setFilter(Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== ''))); setPage(1); }
  const rows = data?.items || [], pages = Math.max(1, Math.ceil((data?.total || 0) / 20));
  return <>
    <form className="admin-filters" onSubmit={submit}>
      <label>Поиск<input {...field('q')} maxLength={100} placeholder={type === 'audit' ? 'Администратор или действие' : 'Почта, код или название'} /></label>
      {type === 'bookings' && <><label>Статус<select {...field('status')}><option value="">Все</option>{Object.entries(statuses).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label><label>С даты<input type="date" {...field('from')} /></label><label>По дату<input type="date" {...field('to')} /></label></>}
      {['users', 'rooms'].includes(type) && <label>Активность<select {...field('active')}><option value="">Все</option><option value="true">Активные</option><option value="false">Отключённые</option></select></label>}
      {type === 'rooms' && <label>Блок<select {...field('block')}><option value="">Все</option>{['C1.1', 'C1.2', 'C1.3'].map(block => <option key={block}>{block}</option>)}</select></label>}
      {type === 'rooms' && <>{[['date', 'Дата', 'date'], ['start', 'С', 'time'], ['end', 'До', 'time']].map(([key, title, inputType]) => <label key={key}>{title}<input type={inputType} required value={intervalDraft[key]} onChange={event => setIntervalDraft(value => ({ ...value, [key]: event.target.value }))} /></label>)}</>}
      {type === 'users' && <label>Роль<select {...field('role')}><option value="">Все</option><option value="user">Пользователи</option><option value="admin">Администраторы</option></select></label>}
      <button className="admin-primary" disabled={loading}>Найти</button><button type="button" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Обновить</button>
    </form>
    {type === 'rooms' && <p className="admin-interval-note">Занятость: {interval.date} · {interval.start}–{interval.end} (Астана). Активность означает, что помещение включено; занятость учитывает брони на выбранное время.</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    {loading && <p role="status">Загружаем записи…</p>}
    <div className="admin-table-scroll"><table className="admin-table"><caption>{labels[type]} · найдено: {data?.total ?? '…'}</caption><thead><tr>
      {type === 'rooms' && <><th>Помещение</th><th>Этаж / тип</th><th>Вместимость</th><th>Активность</th><th>Занятость на выбранное время</th><th>Действие</th></>}
      {type === 'users' && <><th>Пользователь</th><th>Роль</th><th>Активность</th><th>Microsoft / 2FA</th><th>Последний вход</th><th>Действие</th></>}
      {type === 'bookings' && <><th>№ / пользователь</th><th>Помещение</th><th>Дата / время</th><th>Цель</th><th>Статус</th><th>Действие</th></>}
      {type === 'audit' && <><th>Дата</th><th>Администратор</th><th>Действие</th><th>Объект</th><th>Изменения</th></>}
    </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
      {type === 'rooms' && <><td><strong>{row.code}</strong>{row.name && <small>{row.name}</small>}</td><td>{row.floor} / {row.room_type}</td><td>{row.capacity ?? 'Не указана'}</td><td>{row.is_active ? 'Включено' : 'Отключено'}</td><td><span className={`admin-availability ${!loading && !error ? availability?.[String(row.id)] || '' : ''}`}>{loading ? 'Проверяем…' : error ? 'Не удалось проверить' : ({ available: 'Свободно', occupied: 'Занято', unavailable: 'Отключено' }[availability?.[String(row.id)]] || 'Неизвестно')}</span></td><td><button onClick={() => setEditing(row)}>Изменить</button></td></>}
      {type === 'users' && <><td><strong>{row.name}</strong><small>{row.email}</small></td><td>{row.role === 'admin' ? 'Администратор' : 'Пользователь'}</td><td>{row.is_active ? 'Активен' : 'Отключён'}</td><td>{row.microsoft_linked ? 'Microsoft ✓' : 'Не привязан'} / {row.two_factor_enabled ? '2FA ✓' : 'Без 2FA'}</td><td>{dateTime(row.last_login_at)}</td><td><button disabled={String(user.id) === row.id} onClick={() => setEditing(row)}>Изменить</button></td></>}
      {type === 'bookings' && <><td>#{row.id}<small>{row.email}</small></td><td>{row.room_code}</td><td>{row.booking_date}<small>{row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}</small></td><td>{row.purpose}</td><td>{statuses[row.status]}{row.cancellation_reason && <small>{row.cancellation_reason}</small>}</td><td><button disabled={row.status === 'cancelled'} onClick={() => setEditing(row)}>Отменить</button></td></>}
      {type === 'audit' && <><td>{dateTime(row.created_at)}</td><td>{row.actor_email}</td><td>{row.action}</td><td>{row.resource_type} #{row.resource_id}</td><td><details><summary>До / после</summary><pre>{JSON.stringify({ before: row.before_data, after: row.after_data }, null, 2)}</pre></details></td></>}
    </tr>)}</tbody></table></div>
    {!loading && !error && rows.length === 0 && <p className="admin-muted">Нет записей по выбранным фильтрам.</p>}
    <div className="admin-pagination"><button disabled={loading || page <= 1} onClick={() => { setLoading(true); setPage(page - 1); }}>Назад</button><span>Страница {page} из {pages}</span><button disabled={loading || page >= pages} onClick={() => { setLoading(true); setPage(page + 1); }}>Далее</button></div>
    {editing && <Editor type={type} item={editing} currentUser={user} onClose={() => setEditing(null)} onSaved={() => { setLoading(true); setRevision(value => value + 1); }} />}
  </>;
}

export default function AdminPanel({ user }) {
  const [tab, setTab] = useState('overview'), [revision, setRevision] = useState(0);
  return <main className="admin-page"><header className="admin-heading"><div><p>BOOKAITU / УПРАВЛЕНИЕ</p><h1>Панель администратора</h1><span>Управление университетскими помещениями и бронированиями</span></div><button onClick={() => setRevision(value => value + 1)}>Обновить раздел</button></header>
    <nav className="admin-nav" aria-label="Разделы администрирования">{Object.entries(labels).map(([key, title]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{title}</button>)}</nav>
    {tab === 'overview' ? <Overview key={revision} /> : <Records key={`${tab}-${revision}`} type={tab} user={user} />}
  </main>;
}
