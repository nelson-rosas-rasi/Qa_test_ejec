const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchIdentity } = require('../main/github/identity');

test('devuelve la identidad de la cuenta', async () => {
  const identity = await fetchIdentity({
    token: 't',
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ login: 'maria-gomez', name: 'María Gómez', avatar_url: 'https://x/a.png' }) }),
  });
  assert.deepEqual(identity, { login: 'maria-gomez', name: 'María Gómez', avatarUrl: 'https://x/a.png' });
});

test('sin nombre público cae al login', async () => {
  const identity = await fetchIdentity({
    token: 't',
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ login: 'maria-gomez', name: null, avatar_url: 'https://x/a.png' }) }),
  });
  assert.equal(identity.name, 'maria-gomez');
});

test('manda el token en la cabecera', async () => {
  let headers;
  await fetchIdentity({
    token: 'gho_abc',
    fetch: async (_url, options) => { headers = options.headers; return { ok: true, status: 200, json: async () => ({ login: 'x' }) }; },
  });
  assert.equal(headers.Authorization, 'Bearer gho_abc');
});

test('un 401 se traduce a GITHUB_TOKEN_INVALID', async () => {
  await assert.rejects(
    fetchIdentity({ token: 't', fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) }),
    (err) => err.code === 'GITHUB_TOKEN_INVALID',
  );
});

test('un fallo de red se traduce a GITHUB_UNREACHABLE, no a token inválido', async () => {
  await assert.rejects(
    fetchIdentity({ token: 't', fetch: async () => { throw new Error('ENOTFOUND'); } }),
    (err) => err.code === 'GITHUB_UNREACHABLE',
  );
});
