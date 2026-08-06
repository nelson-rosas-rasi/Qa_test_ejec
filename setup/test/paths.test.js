const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { binaryPaths, browsersDir, markerPath } = require('../main/paths');

const ENV = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local' };

test('resuelve los cuatro binarios bajo Archivos de programa', () => {
  const paths = binaryPaths(ENV);
  assert.equal(paths.git, path.join('C:\\Program Files', 'Git', 'cmd', 'git.exe'));
  assert.equal(paths.node, path.join('C:\\Program Files', 'nodejs', 'node.exe'));
  assert.equal(paths.npm, path.join('C:\\Program Files', 'nodejs', 'npm.cmd'));
  assert.equal(paths.npx, path.join('C:\\Program Files', 'nodejs', 'npx.cmd'));
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
