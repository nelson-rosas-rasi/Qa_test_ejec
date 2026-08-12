const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveCommand } = require('../main/runtime/windows-paths');

// Deliberadamente distinto del valor por defecto del módulo: si fuera
// 'C:\\Program Files', un módulo que ignorara `env` pasaría igual los tests.
const ENV = { ProgramFiles: 'D:\\Programas' };

test('en Windows usa la ruta conocida cuando el archivo existe', () => {
  const ruta = resolveCommand('git', { exists: () => true, env: ENV, platform: 'win32' });
  assert.equal(ruta, path.join('D:\\Programas', 'Git', 'cmd', 'git.exe'));
});

test('si la ruta conocida no existe deja el nombre para que lo busque el sistema', () => {
  const ruta = resolveCommand('git', { exists: () => false, env: ENV, platform: 'win32' });
  assert.equal(ruta, 'git');
});

test('npm resuelve al .cmd de Node', () => {
  const ruta = resolveCommand('npm.cmd', { exists: () => true, env: ENV, platform: 'win32' });
  assert.equal(ruta, path.join('D:\\Programas', 'nodejs', 'npm.cmd'));
});

test('fuera de Windows no toca nada', () => {
  assert.equal(resolveCommand('git', { exists: () => true, env: ENV, platform: 'linux' }), 'git');
});
