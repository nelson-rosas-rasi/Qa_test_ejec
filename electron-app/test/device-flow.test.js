const test = require('node:test');
const assert = require('node:assert/strict');
const { requestDeviceCode } = require('../main/github/device-flow');

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
