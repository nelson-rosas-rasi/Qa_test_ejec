const test = require('node:test');
const assert = require('node:assert/strict');
const { readGithubConfig } = require('../main/github/config');

test('lee el client_id del entorno', () => {
  assert.deepEqual(readGithubConfig({ QA_GITHUB_CLIENT_ID: 'Iv1.abc123' }), { clientId: 'Iv1.abc123', scope: 'repo' });
});

test('sin client_id configurado devuelve cadena vacía, no un valor inventado', () => {
  assert.equal(readGithubConfig({}).clientId, '');
});
