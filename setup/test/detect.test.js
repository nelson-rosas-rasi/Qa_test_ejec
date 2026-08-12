const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPrerequisites } = require('../main/detect');

const ENV = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local' };
const MINIMOS = { git: '2.30.0', node: '20.0.0' };

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
    readBrowsersDir: () => ['chromium-1208', 'firefox-1489', 'webkit-2140'],
  });
  assert.deepEqual(state.git, { ok: true, version: '2.51.0' });
  assert.deepEqual(state.node, { ok: true, version: '22.21.0' });
  assert.deepEqual(state.npm, { ok: true, version: '10.9.0' });
  assert.deepEqual(state.browsers, { ok: true, version: '1.58.2' });
});

test('un binario que no está ni en la ruta fija ni en el PATH queda en falta', async () => {
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

/**
 * El equipo del QA ya puede traer git y Node puestos por winget, por Chocolatey
 * o a mano en otro disco. Mirando sólo %ProgramFiles% el setup los daba por
 * ausentes y reinstalaba encima: reinstalar Node sobre una copia existente es
 * justamente de donde salía el 1603. Si el binario responde por PATH, está.
 */
test('git instalado fuera de Archivos de programa se encuentra por PATH', async () => {
  const state = await detectPrerequisites({
    exists: () => false,
    run: (cmd) => (cmd === 'git' ? Promise.resolve({ stdout: 'git version 2.43.0\n' }) : Promise.reject(new Error('no está'))),
    env: ENV,
    minimums: MINIMOS,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(state.git, { ok: true, version: '2.43.0' });
});

test('Node instalado en otro disco se encuentra por PATH, con su npm', async () => {
  const porPath = { node: 'v20.11.1\n', 'npm.cmd': '10.2.4\n', npm: '10.2.4\n' };
  const state = await detectPrerequisites({
    exists: () => false,
    run: (cmd) => (porPath[cmd] ? Promise.resolve({ stdout: porPath[cmd] }) : Promise.reject(new Error('no está'))),
    env: ENV,
    minimums: MINIMOS,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.equal(state.node.ok, true);
  assert.equal(state.node.version, '20.11.1');
  assert.equal(state.npm.ok, true);
});

/**
 * La otra mitad de "no saltes la verificación": estar presente no alcanza. Un
 * Node viejo en la ruta esperada pasaba como hecho y el setup lo saltaba; el
 * fallo aparecía mucho después, al correr `npm ci` en un proyecto.
 */
test('una versión por debajo del mínimo cuenta como falta, no como hecha', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: (cmd) => (cmd.endsWith('node.exe') ? Promise.resolve({ stdout: 'v18.20.4\n' }) : runFake(cmd)),
    env: ENV,
    minimums: MINIMOS,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.equal(state.node.ok, false);
  assert.equal(state.node.version, '18.20.4');
  // La versión encontrada se conserva para poder decirle al QA qué tiene puesto.
  assert.equal(state.node.reason, 'outdated');
});

test('una versión más nueva que la fijada sirve y no se reinstala', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: (cmd) => (cmd.endsWith('node.exe') ? Promise.resolve({ stdout: 'v24.3.0\n' }) : runFake(cmd)),
    env: ENV,
    minimums: MINIMOS,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(state.node, { ok: true, version: '24.3.0' });
});

test('compara por número y no por texto: 10.9.0 supera a 9.1.0', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: (cmd) => (cmd.endsWith('git.exe') ? Promise.resolve({ stdout: 'git version 10.9.0\n' }) : runFake(cmd)),
    env: ENV,
    minimums: { ...MINIMOS, git: '9.1.0' },
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.equal(state.git.ok, true);
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

/**
 * El marcador es lo que el setup dijo haber hecho; la caché es lo que hay. Si
 * alguien limpió %LOCALAPPDATA%\ms-playwright, el marcador sobrevive y el setup
 * saltaba el paso: el QA terminaba con "Executable doesn't exist" recién al
 * correr una prueba. Verificar el hecho y no la afirmación cuesta un readdir.
 */
test('el marcador coincide pero la caché está vacía: cuentan como falta', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
    readBrowsersDir: () => [],
  });
  assert.equal(state.browsers.ok, false);
});

test('el marcador coincide y la caché tiene navegadores: está hecho', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
    readBrowsersDir: () => ['chromium-1208', 'firefox-1489', '.links'],
  });
  assert.deepEqual(state.browsers, { ok: true, version: '1.58.2' });
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
