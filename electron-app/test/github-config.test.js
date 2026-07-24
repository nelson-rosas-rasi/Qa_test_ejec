const test = require('node:test');
const assert = require('node:assert/strict');
const { readGithubConfig } = require('../main/github/config');

test('lee el client_id del entorno', () => {
  assert.deepEqual(readGithubConfig({ QA_GITHUB_CLIENT_ID: 'Iv1.abc123' }), { clientId: 'Iv1.abc123', scope: 'repo' });
});

test('sin variable de entorno usa el client_id compilado de RunQA', () => {
  assert.equal(readGithubConfig({}).clientId, 'Ov23liMOkAFDVIiaEjL6');
});
