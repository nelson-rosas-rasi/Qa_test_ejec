const test = require('node:test');
const assert = require('node:assert/strict');
const { nodeProcessEnv } = require('../main/runtime/node-process');

test('activa el modo Node cuando el proceso padre es Electron', () => {
  assert.equal(nodeProcessEnv({}, true).ELECTRON_RUN_AS_NODE, '1');
});

test('no fuerza el modo Electron cuando se usa Node real', () => {
  assert.equal(nodeProcessEnv({}, false).ELECTRON_RUN_AS_NODE, undefined);
});
