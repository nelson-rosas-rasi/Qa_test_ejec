const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore } = require('../main/config-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-config-'));
}

test('getProject devuelve un objeto vacío cuando no hay archivo', () => {
  const store = createConfigStore(tempDir());
  assert.deepEqual(store.getProject('erp'), {});
});

test('setProject persiste y getProject lo lee de vuelta', () => {
  const dir = tempDir();
  createConfigStore(dir).setProject('erp', { repoPath: 'C:/qa/erp' });
  assert.deepEqual(createConfigStore(dir).getProject('erp'), { repoPath: 'C:/qa/erp' });
});

test('setProject mezcla en vez de reemplazar', () => {
  const store = createConfigStore(tempDir());
  store.setProject('erp', { repoPath: 'C:/qa/erp' });
  store.setProject('erp', { profile: 'demo' });
  assert.deepEqual(store.getProject('erp'), { repoPath: 'C:/qa/erp', profile: 'demo' });
});

test('un archivo corrupto no rompe la app', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ esto no es json');
  assert.deepEqual(createConfigStore(dir).getProject('erp'), {});
});

test('los proyectos no se pisan entre sí', () => {
  const store = createConfigStore(tempDir());
  store.setProject('erp', { profile: 'a' });
  store.setProject('medical', { profile: 'b' });
  assert.equal(store.getProject('erp').profile, 'a');
  assert.equal(store.getProject('medical').profile, 'b');
});

test('un error de lectura que no sea "no existe" se propaga', () => {
  const dir = tempDir();
  // Un directorio donde debería ir el archivo: readFileSync falla con EISDIR.
  fs.mkdirSync(path.join(dir, 'config.json'));
  assert.throws(() => createConfigStore(dir).getProject('erp'), (err) => err.code === 'EISDIR');
});

test('setProject crea la carpeta de configuración si no existe', () => {
  const dir = path.join(tempDir(), 'anidada', 'config');
  createConfigStore(dir).setProject('erp', { profile: 'demo' });
  assert.equal(createConfigStore(dir).getProject('erp').profile, 'demo');
});

test('listProjects devuelve el catálogo persistido', () => {
  const store = createConfigStore(tempDir());
  store.setProject('erp', { name: 'ERP', defaultBranch: 'main' });
  assert.deepEqual(store.listProjects(), [{ id: 'erp', name: 'ERP', defaultBranch: 'main' }]);
});

test('getSetting devuelve undefined cuando la clave no existe', () => {
  assert.equal(createConfigStore(tempDir()).getSetting('github'), undefined);
});

test('setSetting persiste una clave global sin pisar los proyectos', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setProject('erp', { profile: 'demo' });
  store.setSetting('github', { token: 'xyz' });
  assert.deepEqual(createConfigStore(dir).getSetting('github'), { token: 'xyz' });
  assert.deepEqual(createConfigStore(dir).getProject('erp'), { profile: 'demo' });
});

test('setProject no borra las claves globales', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setSetting('github', { token: 'xyz' });
  store.setProject('erp', { profile: 'demo' });
  assert.deepEqual(createConfigStore(dir).getSetting('github'), { token: 'xyz' });
});

test('setSetting con null borra la clave', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setSetting('github', { token: 'xyz' });
  store.setSetting('github', null);
  assert.equal(createConfigStore(dir).getSetting('github'), undefined);
});
