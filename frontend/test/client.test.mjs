import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../src/api/client.js', import.meta.url), 'utf8')).replaceAll('import.meta.env.VITE_API_URL', 'undefined').replaceAll('import.meta.env.PROD', 'false');
const { API, request } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('production defaults to the same origin for API requests', async () => {
  const production = source.replace("(false ? ''", "(true ? ''");
  const client = await import(`data:text/javascript;base64,${Buffer.from(production).toString('base64')}`);
  assert.equal(client.API, '');
});
test('API uses credentials, rotates CSRF, preserves errors and handles logout', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [], events = [];
  const responses = [
    new Response(JSON.stringify({ csrfToken: 'initial', status: 'anonymous' })),
    new Response(JSON.stringify({ csrfToken: 'after-login', status: 'authenticated' })),
    new Response(JSON.stringify({ id: '41' }), { status: 201 }),
    new Response(JSON.stringify({ error: 'Room is already booked for this time' }), { status: 409 }),
    new Response(null, { status: 204 }),
    new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 }),
  ];
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return responses.shift(); };
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  try {
    assert.equal(API, 'http://localhost:3101');
    await request('/api/auth/session');
    await request('/api/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code: '123456' }) });
    const booking = await request('/api/bookings', { method: 'POST', body: JSON.stringify({ room_id: '9' }) });
    assert.equal(booking.id, '41');
    assert.equal(calls[1].headers['X-CSRF-Token'], 'initial');
    assert.equal(calls[2].headers['X-CSRF-Token'], 'after-login');
    assert.equal(calls[2].headers['Content-Type'], 'application/json');
    assert.ok(calls.every(call => call.credentials === 'include'));
    await assert.rejects(request('/api/bookings', { method: 'POST' }), error => error.status === 409 && error.message.includes('already booked'));
    assert.equal(await request('/api/bookings/41', { method: 'DELETE' }), undefined);
    await assert.rejects(request('/api/rooms'), error => error.status === 401);
    assert.deepEqual(events, ['session-expired']);
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});
