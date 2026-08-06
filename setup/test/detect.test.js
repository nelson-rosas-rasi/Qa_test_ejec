const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPrerequisites } = require('../main/detect');

const ENV = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local' };

const versions = {
  'git.exe': 'git version 2.51.0.windows.1\n',
  'node.exe': 'v22.21.0\n',
  'npm.cmd': '10.9.0\n',
};
const runFake = (cmd) => {
  const key = Object.keys(versions).find((name) => cmd.endsWith(name));
  if (!key) throw new Error(`comando inesperado: ${cmd}`);
  return Promise.resolve({ stdout: versions[key] });
};

test('todo instalado devuelve ok y las versiones limpias', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(state.git, { ok: true, version: '2.51.0' });
  assert.deepEqual(state.node, { ok: true, version: '22.21.0' });
  assert.deepEqual(state.npm, { ok: true, version: '10.9.0' });
  assert.deepEqual(state.browsers, { ok: true, version: '1.58.2' });
});

test('un binario ausente no se ejecuta y queda en falta', async () => {
  const state = await detectPrerequisites({
    exists: (ruta) => !ruta.endsWith('git.exe'),
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(state.git, { ok: false, version: null });
  assert.equal(state.node.ok, true);
});

test('un binario presente pero ilegible cuenta como falta', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: (cmd) => (cmd.endsWith('node.exe') ? Promise.reject(new Error('acceso denegado')) : runFake(cmd)),
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(state.node, { ok: false, version: null });
});

test('navegadores de otra versión cuentan como falta', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.49.0' }),
  });
  assert.deepEqual(state.browsers, { ok: false, version: '1.49.0' });
});

test('sin marcador los navegadores cuentan como falta', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => null,
  });
  assert.deepEqual(state.browsers, { ok: false, version: null });
});
