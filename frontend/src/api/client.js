export const API = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3101')).replace(/\/$/, '');
let csrfToken;
let pendingSession;
export function readSession() {
  // React StrictMode and multiple consumers must share initial cookie creation.
  if (!pendingSession) pendingSession = request('/api/auth/session').finally(() => { pendingSession = undefined; });
  return pendingSession;
}
export const setCsrfToken = value => { csrfToken = value; };

export async function request(path, options) {
  const response = await fetch(`${API}${path}`, { ...options, credentials: 'include',
    headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.method && options.method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...options?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = body.code;
    if (response.status === 401 && (body.code === 'AUTH_REQUIRED' || body.code === 'MICROSOFT_LOGIN_REQUIRED' || !body.code)) window.dispatchEvent(new Event('session-expired'));
    throw error;
  }
  if (response.status === 204) return undefined;
  const result = await response.json();
  if (result.csrfToken) setCsrfToken(result.csrfToken);
  return result;
}
