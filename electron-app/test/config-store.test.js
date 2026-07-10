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
