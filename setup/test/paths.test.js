const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { binaryPaths, browsersDir, markerPath } = require('../main/paths');

// Deliberadamente distinto del valor por defecto del módulo: si fuera
// 'C:\\Program Files', un módulo que ignorara `env` pasaría igual los tests.
const ENV = { ProgramFiles: 'D:\\Programas', LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local', SystemRoot: 'E:\\Windows' };

test('resuelve los cuatro binarios bajo Archivos de programa', () => {
  const paths = binaryPaths(ENV);
  assert.equal(paths.git, path.join('D:\\Programas', 'Git', 'cmd', 'git.exe'));
  assert.equal(paths.node, path.join('D:\\Programas', 'nodejs', 'node.exe'));
  assert.equal(paths.npm, path.join('D:\\Programas', 'nodejs', 'npm.cmd'));
  assert.equal(paths.npx, path.join('D:\\Programas', 'nodejs', 'npx.cmd'));
  assert.equal(paths.msiexec, path.join('E:\\Windows', 'System32', 'msiexec.exe'));
});

test('la caché de navegadores vive en el perfil del usuario', () => {
  assert.equal(browsersDir(ENV), path.join(ENV.LOCALAPPDATA, 'ms-playwright'));
  assert.equal(markerPath(ENV), path.join(ENV.LOCALAPPDATA, 'ms-playwright', '.runqa-setup.json'));
});

test('sin las variables de Windows usa los valores por defecto', () => {
  const paths = binaryPaths({});
  assert.ok(paths.git.endsWith(path.join('Git', 'cmd', 'git.exe')));
  assert.ok(browsersDir({}).endsWith('ms-playwright'));
});
