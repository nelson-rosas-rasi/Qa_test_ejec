const test = require('node:test');
const assert = require('node:assert/strict');
const { appError } = require('../main/errors');

test('appError produce un Error con código y mensaje', () => {
  const err = appError('NO_PROFILE', 'No hay perfiles.');
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'NO_PROFILE');
  assert.equal(err.message, 'No hay perfiles.');
});
