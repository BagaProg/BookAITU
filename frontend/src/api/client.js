export const API = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3101')).replace(/\/$/, '');
let csrfToken;
export const setCsrfToken = value => { csrfToken = value; };

export async function request(path, options) {
  const response = await fetch(`${API}${path}`, { ...options, credentials: 'include',
    headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.method && options.method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...options?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    throw error;
  }
  if (response.status === 204) return undefined;
  const result = await response.json();
  if (result.csrfToken) setCsrfToken(result.csrfToken);
  return result;
}
