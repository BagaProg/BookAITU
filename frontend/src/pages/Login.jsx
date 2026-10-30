import { useEffect, useState } from 'react';
import { API, request } from '../api/client';
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
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
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
    request('/api/auth/session').then(setSession).catch(err => setError(err.message));
  }, []);
  useEffect(() => {
    const expire = () => { setSession(null); request('/api/auth/session').then(setSession).catch(err => setError(err.message)); };
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  async function act(work) {
    setBusy(true); setError('');
    try { await work(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const logout = () => act(async () => {
    await request('/api/auth/logout', { method: 'POST' });
    setSetup(null); setCodes(null); setCode('');
    setSession(await request('/api/auth/session'));
  });
  const submit = event => {
    event.preventDefault();
    act(async () => {
      const result = await request(session.status === 'enrollment_required' ? '/api/auth/2fa/confirm' : '/api/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) });
      setSetup(null); setCode(''); setCodes(result.recoveryCodes || null); setSession(result);
    });
  };
  if (session?.status === 'authenticated' && !codes) return <AccountContext.Provider value={{ user: session.user, logout, busy, error }}>
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
      {setup && <><img className="auth-qr" src={setup.qrCode} alt="QR-код настройки BookAITU в приложении-аутентификаторе" /><p className="auth-small">Или введите ключ вручную:</p><code className="auth-secret">{setup.secret}</code></>}
    </>}
    {(session?.status === 'two_factor_required' || (session?.status === 'enrollment_required' && setup)) && <form onSubmit={submit}>
      <label htmlFor="otp">{session.status === 'enrollment_required' ? 'Шестизначный код из приложения' : 'Код из приложения или резервный код'}</label>
      <input id="otp" autoComplete="one-time-code" inputMode={session.status === 'enrollment_required' ? 'numeric' : 'text'} value={code} maxLength={80} onChange={event => setCode(event.target.value)} required />
      <button className="auth-primary" disabled={busy}>{busy ? 'Проверяем…' : 'Подтвердить вход'}</button>
    </form>}
    {codes && <><h2>Сохраните резервные коды</h2><p>Они показываются один раз. Каждый код заменяет второй фактор только для одного входа. Храните отдельно от устройства.</p><textarea className="auth-codes" readOnly rows={10} value={codes.join('\n')} aria-label="Одноразовые резервные коды" /><button className="auth-primary" onClick={() => setCodes(null)}>Я сохранил коды — продолжить</button></>}
    {session && session.status !== 'anonymous' && <button disabled={busy} onClick={logout}>Выйти и сменить аккаунт</button>}
  </section></main>;
}
