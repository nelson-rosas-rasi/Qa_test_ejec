const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { checkBrowsers, browsersDir } = require('../main/playwright/browsers');

const repo = 'C:\\proyectos\\erp';

test('coinciden versión del proyecto y navegadores instalados', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => ({ version: '1.58.2' }),
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(estado, { ok: true, expected: '1.58.2', installed: '1.58.2' });
});

test('el proyecto pide otra versión que la instalada', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => ({ version: '1.49.0' }),
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(estado, { ok: false, reason: 'mismatch', expected: '1.49.0', installed: '1.58.2' });
});

/**
 * El marcador lo escribe únicamente RunQA Setup. Un equipo que ya tenía los
 * navegadores —puestos a mano, o por una versión anterior de la app— no lo
 * tiene, y bloquearlo por eso deja sin abrir proyectos que venían funcionando.
 * Sin marcador no sabemos qué versión hay; "no sé" no es "falta".
 */
test('con los navegadores en el perfil pero sin marcador no bloquea', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => ({ version: '1.58.2' }),
    readMarker: () => null,
    readDir: () => ['chromium-1208', 'firefox-1489', 'webkit-2140'],
  });
  assert.deepEqual(estado, { ok: true, expected: '1.58.2', installed: null });
});

test('sin ningún navegador en el perfil avisa que faltan', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => ({ version: '1.58.2' }),
    readMarker: () => null,
    readDir: () => [],
  });
  assert.deepEqual(estado, { ok: false, reason: 'missing', expected: '1.58.2', installed: null });
});

/** La caché de Playwright tiene archivos sueltos (`.links`, locks) que no son
 *  navegadores: contarlos daría por instalado un perfil vacío. */
test('los archivos sueltos de la caché no cuentan como navegadores', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => ({ version: '1.58.2' }),
    readMarker: () => null,
    readDir: () => ['.links', 'algo-suelto.txt'],
  });
  assert.equal(estado.reason, 'missing');
});

test('si la caché no existe no revienta: avisa que faltan', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => ({ version: '1.58.2' }),
    readMarker: () => null,
    readDir: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  });
  assert.equal(estado.reason, 'missing');
});

test('en Windows la caché sale del perfil del usuario', () => {
  assert.equal(
    browsersDir({ LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local' }, 'win32', 'C:\\Users\\qa'),
    path.join('C:\\Users\\qa\\AppData\\Local', 'ms-playwright'),
  );
});

/** Sin esto, en Linux `LOCALAPPDATA` vacío dejaba una ruta relativa ilegible y
 *  la app decía "faltan navegadores" con la caché puesta y llena. */
test('en Linux y macOS la caché sale del home, no de LOCALAPPDATA', () => {
  assert.equal(browsersDir({}, 'linux', '/home/qa'), path.join('/home/qa', '.cache', 'ms-playwright'));
  assert.equal(browsersDir({}, 'darwin', '/Users/qa'), path.join('/Users/qa', 'Library', 'Caches', 'ms-playwright'));
});

test('PLAYWRIGHT_BROWSERS_PATH manda salvo el valor especial 0', () => {
  assert.equal(browsersDir({ PLAYWRIGHT_BROWSERS_PATH: '/opt/navegadores' }, 'linux', '/home/qa'), '/opt/navegadores');
  assert.equal(
    browsersDir({ PLAYWRIGHT_BROWSERS_PATH: '0' }, 'linux', '/home/qa'),
    path.join('/home/qa', '.cache', 'ms-playwright'),
  );
});

test('si no se puede leer la versión del proyecto no bloquea', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => null,
    readMarker: () => null,
  });
  assert.equal(estado.ok, true);
});
