const test = require('node:test');
const assert = require('node:assert/strict');
const { requestDeviceCode, pollForToken } = require('../main/github/device-flow');

const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('pide el código y traduce la respuesta de GitHub', async () => {
  const device = await requestDeviceCode({
    clientId: 'cli123',
    fetch: okJson({
      device_code: 'dev-abc',
      user_code: 'WDJB-MJHT',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900,
    }),
  });
  assert.deepEqual(device, {
    deviceCode: 'dev-abc',
    userCode: 'WDJB-MJHT',
    verificationUri: 'https://github.com/login/device',
    interval: 5,
    expiresIn: 900,
  });
});

test('manda el client_id y el scope pedido', async () => {
  let sent;
  await requestDeviceCode({
    clientId: 'cli123',
    scope: 'repo',
    fetch: async (_url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ device_code: 'd', user_code: 'u', verification_uri: 'v' }) }; },
  });
  assert.deepEqual(sent, { client_id: 'cli123', scope: 'repo' });
});

test('un fallo de red se traduce a GITHUB_UNREACHABLE', async () => {
  await assert.rejects(
    requestDeviceCode({ clientId: 'c', fetch: async () => { throw new Error('ECONNREFUSED'); } }),
    (err) => err.code === 'GITHUB_UNREACHABLE',
  );
});

test('una respuesta HTTP con error se traduce a GITHUB_UNREACHABLE', async () => {
  await assert.rejects(
    requestDeviceCode({ clientId: 'c', fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }),
    (err) => err.code === 'GITHUB_UNREACHABLE',
  );
});

const replies = (list) => async () => ({ ok: true, status: 200, json: async () => list.shift() });
const base = { clientId: 'c', deviceCode: 'd', interval: 1, expiresIn: 900, sleep: async () => {} };

test('espera mientras está pendiente y devuelve el token al aprobar', async () => {
  const token = await pollForToken({
    ...base,
    fetch: replies([{ error: 'authorization_pending' }, { access_token: 'gho_secreto' }]),
  });
  assert.equal(token, 'gho_secreto');
});

test('slow_down adopta el intervalo nuevo que manda GitHub', async () => {
  const waits = [];
  await pollForToken({
    ...base,
    sleep: async (ms) => { waits.push(ms); },
    fetch: replies([{ error: 'slow_down', interval: 10 }, { access_token: 't' }]),
  });
  assert.deepEqual(waits, [1000, 10000]);
});

test('un código caducado se traduce a GITHUB_CODE_EXPIRED', async () => {
  await assert.rejects(
    pollForToken({ ...base, fetch: replies([{ error: 'expired_token' }]) }),
    (err) => err.code === 'GITHUB_CODE_EXPIRED',
  );
});

test('el rechazo del usuario se traduce a GITHUB_ACCESS_DENIED', async () => {
  await assert.rejects(
    pollForToken({ ...base, fetch: replies([{ error: 'access_denied' }]) }),
    (err) => err.code === 'GITHUB_ACCESS_DENIED',
  );
});

test('agotar el plazo sin aprobación caduca el código', async () => {
  await assert.rejects(
    pollForToken({ ...base, expiresIn: 0, fetch: replies([{ access_token: 'no-debería-pedirse' }]) }),
    (err) => err.code === 'GITHUB_CODE_EXPIRED',
  );
});

test('cancelar aborta la espera', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    pollForToken({ ...base, signal: controller.signal, fetch: replies([{ access_token: 't' }]) }),
    (err) => err.code === 'GITHUB_CONNECT_CANCELLED',
  );
});
