const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecordingsStore } = require('../main/recordings/store');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-rec-'));

function withSpec(store, projectId, id, name) {
  fs.mkdirSync(path.dirname(store.specFile(projectId, id)), { recursive: true });
  fs.writeFileSync(store.specFile(projectId, id), '// test');
  return store.saveMeta(projectId, id, name);
}

test('guarda meta y la lista', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  withSpec(store, 'erp', 'grab-1', 'Uno');
  const list = store.list('erp');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Uno');
  assert.equal(list[0].status, 'draft');
  assert.equal(list[0].uploaded, null);
});

test('guarda el perfil con el que se hizo la grabación', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  store.saveMeta('erp', 'grab-1', 'Login', 'nelson_vid', 'Nelson Rosas');
  assert.equal(store.list('erp')[0].profileId, 'nelson_vid');
  assert.equal(store.list('erp')[0].profileName, 'Nelson Rosas');
});

test('renombra', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  withSpec(store, 'erp', 'grab-1', 'Uno');
  store.rename('erp', 'grab-1', 'Dos');
  assert.equal(store.list('erp')[0].name, 'Dos');
});

test('marca subido', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  withSpec(store, 'erp', 'grab-1', 'Uno');
  const m = store.markUploaded('erp', 'grab-1', 'drafts/uno');
  assert.equal(m.status, 'uploaded');
  assert.equal(m.uploaded.branch, 'drafts/uno');
});

test('infiere el estado de metadatos antiguos sin status', () => {
  const dir = tempDir();
  const store = createRecordingsStore({ dir });
  const projectDir = path.join(dir, 'erp');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'grab-1.json'), JSON.stringify({
    id: 'grab-1', name: 'Antigua', createdAt: '2026-01-01T00:00:00.000Z', uploaded: { branch: 'main', at: '2026-01-02T00:00:00.000Z' },
  }));
  assert.equal(store.list('erp')[0].status, 'uploaded');
});

test('elimina spec y meta', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  withSpec(store, 'erp', 'grab-1', 'Uno');
  store.remove('erp', 'grab-1');
  assert.equal(store.list('erp').length, 0);
  assert.equal(fs.existsSync(store.specFile('erp', 'grab-1')), false);
});

test('list vacío sin carpeta', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  assert.deepEqual(store.list('nada'), []);
});
