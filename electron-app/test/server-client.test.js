const test = require('node:test');
const assert = require('node:assert/strict');
const { createServerClient } = require('../main/server/client');

/** fetch falso: responde según una tabla url->{status, body}. Registra las llamadas. */
function fakeFetch(routes, calls = []) {
  return async (url, opts) => {
    calls.push({ url, opts });
    const r = routes[url];
    if (r === 'NETWORK') throw new Error('ECONNREFUSED');
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    };
  };
}

const BASE = 'http://srv:8080';

test('login OK devuelve token y usuario', async () => {
  const routes = { [`${BASE}/api/auth/login`]: { status: 200, body: { success: true, data: { token: 'tok', username: 'ana', fullName: 'Ana', role: 'QA' } } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).login('ana', 'pw');
  assert.equal(res.ok, true);
  assert.equal(res.token, 'tok');
  assert.equal(res.user.username, 'ana');
});

test('login con credenciales malas -> BAD_CREDENTIALS', async () => {
  const routes = { [`${BASE}/api/auth/login`]: { status: 401, body: { success: false, message: 'Credenciales incorrectas' } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).login('ana', 'mala');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'BAD_CREDENTIALS');
});

test('login sin red no lanza: devuelve ok:false', async () => {
  const routes = { [`${BASE}/api/auth/login`]: 'NETWORK' };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).login('ana', 'pw');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NETWORK');
});

test('postRun 200 -> created true, manda el Bearer', async () => {
  const calls = [];
  const routes = { [`${BASE}/api/runs`]: { status: 200, body: { success: true } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes, calls) }).postRun('tok', { runId: 'run-1' });
  assert.equal(res.ok, true);
  assert.equal(res.created, true);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
});

test('postRun 204 -> ok:true, created false (ya existía)', async () => {
  const routes = { [`${BASE}/api/runs`]: { status: 204 } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).postRun('tok', { runId: 'run-1' });
  assert.equal(res.ok, true);
  assert.equal(res.created, false);
});

test('postRun 401 -> UNAUTHORIZED', async () => {
  const routes = { [`${BASE}/api/runs`]: { status: 401 } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).postRun('tok', { runId: 'run-1' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'UNAUTHORIZED');
});

test('syncModules OK', async () => {
  const routes = { [`${BASE}/api/sync/modules`]: { status: 200, body: { success: true } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) })
    .syncModules('tok', { repoUrl: 'https://git/x.git', projectName: 'ERP', modules: ['a'] });
  assert.equal(res.ok, true);
});

test('listOccurrences codifica el rango y devuelve data', async () => {
  const url = `${BASE}/api/executions/occurrences?from=2026-08-01&to=2026-08-31`;
  const routes = { [url]: { status: 200, body: { success: true, data: [{ id: 7 }] } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) })
    .listOccurrences('tok', { from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(res, { ok: true, data: [{ id: 7 }] });
});

test('listNotifications codifica unreadOnly y manda el Bearer', async () => {
  const calls = [];
  const url = `${BASE}/api/notifications?unreadOnly=true`;
  const routes = { [url]: { status: 200, body: { success: true, data: [{ id: 8 }] } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes, calls) })
    .listNotifications('tok', { unreadOnly: true });
  assert.deepEqual(res, { ok: true, data: [{ id: 8 }] });
  assert.equal(calls[0].opts.method, 'GET');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
});

test('markNotificationRead usa PATCH sobre una notificación', async () => {
  const calls = [];
  const url = `${BASE}/api/notifications/41/read`;
  const routes = { [url]: { status: 200, body: { success: true, data: null } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes, calls) })
    .markNotificationRead('tok', 41);
  assert.deepEqual(res, { ok: true, data: null });
  assert.equal(calls[0].opts.method, 'PATCH');
});

test('markAllNotificationsRead usa PATCH sobre read-all', async () => {
  const calls = [];
  const url = `${BASE}/api/notifications/read-all`;
  const routes = { [url]: { status: 200, body: { success: true, data: null } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes, calls) })
    .markAllNotificationsRead('tok');
  assert.deepEqual(res, { ok: true, data: null });
  assert.equal(calls[0].opts.method, 'PATCH');
});

test('las consultas normalizan errores de red', async () => {
  const url = `${BASE}/api/notifications?unreadOnly=false`;
  const routes = { [url]: 'NETWORK' };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) })
    .listNotifications('tok', { unreadOnly: false });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NETWORK');
});

test('las consultas normalizan 401 como UNAUTHORIZED', async () => {
  const url = `${BASE}/api/executions/occurrences?from=2026-08-01&to=2026-08-31`;
  const routes = { [url]: { status: 401, body: { success: false } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) })
    .listOccurrences('tok', { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'UNAUTHORIZED');
});

test('listOccurrences rechaza un rango incompleto antes de llamar a fetch', async () => {
  const calls = [];
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch({}, calls) })
    .listOccurrences('tok', { from: '2026-08-01' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'INVALID_RANGE');
  assert.equal(calls.length, 0);
});
