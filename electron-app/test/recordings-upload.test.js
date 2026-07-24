const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHeads } = require('../main/recordings/upload');

test('parseHeads extrae y ordena las ramas de ls-remote', () => {
  const out = [
    'abc123\trefs/heads/main',
    'def456\trefs/heads/feature/login',
    'ghi789\trefs/heads/develop',
  ].join('\n');
  assert.deepEqual(parseHeads(out), ['develop', 'feature/login', 'main']);
});

test('parseHeads con salida vacía', () => {
  assert.deepEqual(parseHeads(''), []);
});
