import { useEffect, useRef, useState } from 'react';
import { API, request, readSession } from '../api/client';
import BookingApp from '../BookingApp';
import { AccountContext } from '../components/AccountContext';
import '../auth.css';


const errors = {
  UNIVERSITY_ACCOUNT_REQUIRED: 'Нужен университетский Microsoft-аккаунт. Личные и гостевые аккаунты не допускаются.',
  ACCOUNT_LINK_REQUIRED: 'Учетная запись с этим email уже существует. Администратор должен подтвердить привязку Microsoft-аккаунта.',
  ACCOUNT_DISABLED: 'Учетная запись отключена.',
  MICROSOFT_LOGIN_FAILED: 'Вход не завершён. Попробуйте ещё раз.',
};
const identityErrors = {
  MEMBER_CLAIM_MISSING: 'Microsoft не передал признак участника университета (acct). В настройках приложения Entra: Token configuration → Add optional claim → ID token → acct. Затем повторите вход.',
  MEMBER_ACCOUNT_REQUIRED: 'Microsoft определил аккаунт как гостевой или неподдерживаемый. Нужен аккаунт участника каталога AITU.',
  TENANT_MISMATCH: 'Аккаунт относится к другому каталогу Microsoft. Проверьте аккаунт AITU и Tenant ID в настройках сервера.',
  OBJECT_ID_MISSING: 'Microsoft не передал идентификатор пользователя. Нужна проверка конфигурации приложения Entra.',
  UNIVERSITY_DOMAIN_REQUIRED: 'В ответе Microsoft имя входа не соответствует разрешённому университетскому домену. Проверьте выбранный аккаунт и домены в настройках сервера.',
};

export default function Login() {
  const [session, setSession] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const code = query.get('auth_error');
    if (code === 'UNIVERSITY_ACCOUNT_REQUIRED' && identityErrors[query.get('auth_reason')]) return identityErrors[query.get('auth_reason')];
    return code ? (errors[code] || errors.MICROSOFT_LOGIN_FAILED) : '';
  });
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const loginError = query.get('auth_error');
    if (loginError) window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    let active = true;
    readSession().then(value => { if (active) setSession(value); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const expire = () => { setSetup(null); setCode(''); setSession(null); readSession().then(setSession).catch(err => setError(err.message)); };
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  async function act(work) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    try { await work(); } catch (err) {
      if (['ALREADY_ENROLLED', 'ENROLLMENT_REQUIRED', 'CSRF_INVALID'].includes(err.code)) {
        setSetup(null); setCode('');
        try { setSession(await readSession()); } catch { setSession(null); }
      }
      setError(({ ALREADY_ENROLLED: 'Второй фактор уже настроен. Введите код из приложения.', ENROLLMENT_REQUIRED: 'Подключите приложение-аутентификатор заново.', CSRF_INVALID: 'Сессия обновилась. Повторите действие.', INVALID_SECOND_FACTOR: 'Код не подошёл или уже использован. Введите новый код из записи BookAITU в приложении. Проверьте автоматическую настройку времени на телефоне.', SECOND_FACTOR_LOCKED: 'Слишком много неверных попыток. Подождите 15 минут перед следующей попыткой.', MICROSOFT_LOGIN_REQUIRED: 'Время подтверждения истекло. Войдите через Microsoft ещё раз.' })[err.code] || err.message); } finally { submitting.current = false; setBusy(false); }
  }
  const logout = () => act(async () => {
    await request('/api/auth/logout', { method: 'POST' });
    setSetup(null); setCode('');
    setSession(await readSession());
  });
  const submit = event => {
    event.preventDefault();
    act(async () => {
      const result = await request(session.status === 'enrollment_required' ? '/api/auth/2fa/confirm' : '/api/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) });
      setSetup(null); setCode(''); setSession(result);
    });
  };
  if (session?.status === 'authenticated') return <AccountContext.Provider value={{ user: session.user, logout, busy, error }}>
    <BookingApp user={session.user} />
  </AccountContext.Provider>;
  return <main className="auth-page"><section className="auth-card">
    <p className="auth-brand">BOOKAITU</p><h1>Вход в систему бронирования</h1>
    <p>Университетский Microsoft-аккаунт и код из приложения-аутентификатора.</p>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {!session && <><p>Проверяем соединение…</p><button onClick={() => window.location.reload()}>Повторить</button></>}
    {session?.status === 'anonymous' && <>
      {!session.configured && <p className="auth-notice">Сервер ожидает настройку Microsoft Entra: Tenant ID, Client ID и Client Secret. Вход станет доступен после настройки.</p>}
      <button className="auth-primary" disabled={!session.configured || busy} onClick={() => window.location.assign(`${API}/api/auth/microsoft`)}>Войти через Microsoft</button>
      <p className="auth-small">Личные Outlook/Hotmail и гостевые аккаунты не принимаются. Пароль вводится только на странице Microsoft.</p>
    </>}
    {session?.status === 'enrollment_required' && <>
      <h2>Настройте второй фактор</h2><p>Добавьте BookAITU в Microsoft Authenticator, Google Authenticator или другое приложение с TOTP.</p>
      {!setup && <button disabled={busy} onClick={() => act(async () => setSetup(await request('/api/auth/2fa/setup', { method: 'POST' })))}>Показать QR-код</button>}
      {setup && <><img className="auth-qr" src={setup.qrCode} alt="QR-код настройки BookAITU в приложении-аутентификаторе" /></>}
    </>}
    {(session?.status === 'two_factor_required' || (session?.status === 'enrollment_required' && setup)) && <form onSubmit={submit}>
      <p className="auth-small">Используйте шестизначный код из записи BookAITU в приложении-аутентификаторе. Код входа Microsoft не подходит.</p>
      <p className="auth-small">Потеряли доступ к приложению? Обратитесь к администратору для сброса второго фактора.</p>
      <label htmlFor="otp">Шестизначный код из приложения</label>
      <input id="otp" autoComplete="one-time-code" inputMode="numeric" value={code} maxLength={80} onChange={event => setCode(event.target.value)} required />
      <button className="auth-primary" disabled={busy}>{busy ? 'Проверяем…' : 'Подтвердить вход'}</button>
    </form>}
    {session && session.status !== 'anonymous' && <button disabled={busy} onClick={logout}>Выйти и сменить аккаунт</button>}
  </section></main>;
}
