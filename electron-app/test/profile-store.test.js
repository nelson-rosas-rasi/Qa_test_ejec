const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProfileStore } = require('../main/profiles/store');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-pstore-'));

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (value) => Buffer.from(`cif:${value}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^cif:/, ''),
});

const values = { QA_NOMBRE: 'Ana Ruiz', QA_CARGO: 'QA Lead', TEST_PASSWORD: 'secreta-NUNCA' };

test('guarda y recupera un perfil', () => {
  const dir = tempDir();
  createProfileStore({ dir, safeStorage: fakeSafeStorage() }).save('erp', 'ana-ruiz', values);
  const loaded = createProfileStore({ dir, safeStorage: fakeSafeStorage() }).load('erp', 'ana-ruiz');
  assert.deepEqual(loaded, values);
});

test('la contraseña no queda en claro en el archivo', () => {
  const dir = tempDir();
  createProfileStore({ dir, safeStorage: fakeSafeStorage() }).save('erp', 'ana-ruiz', values);
  const file = path.join(dir, 'erp', 'ana-ruiz.enc');
  assert.equal(fs.readFileSync(file, 'utf8').includes('secreta-NUNCA'), false);
});

test('list devuelve id, nombre y cargo sin la contraseña', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage() });
  store.save('erp', 'ana-ruiz', values);
  store.save('erp', 'beto-paz', { QA_NOMBRE: 'Beto Paz', QA_CARGO: 'QA Tester' });
  const list = store.list('erp');
  assert.deepEqual(list, [
    { id: 'ana-ruiz', name: 'Ana Ruiz', role: 'QA Lead' },
    { id: 'beto-paz', name: 'Beto Paz', role: 'QA Tester' },
  ]);
  assert.equal(JSON.stringify(list).includes('secreta'), false);
});

test('list de un proyecto sin perfiles devuelve []', () => {
  assert.deepEqual(createProfileStore({ dir: tempDir(), safeStorage: fakeSafeStorage() }).list('erp'), []);
});

test('los perfiles de un proyecto no se mezclan con los de otro', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage() });
  store.save('erp', 'ana-ruiz', values);
  assert.deepEqual(store.list('medical'), []);
});

test('sin cifrado disponible lanza y no escribe nada', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage(false) });
  assert.throws(() => store.save('erp', 'ana-ruiz', values), (err) => err.code === 'SECURE_STORAGE_UNAVAILABLE');
  assert.equal(fs.existsSync(path.join(dir, 'erp')), false);
});

test('un perfil ilegible se ignora, no rompe list', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage() });
  store.save('erp', 'ana-ruiz', values);
  const roto = { ...fakeSafeStorage(), decryptString: () => { throw new Error('otra cuenta'); } };
  assert.deepEqual(createProfileStore({ dir, safeStorage: roto }).list('erp'), []);
  assert.equal(createProfileStore({ dir, safeStorage: roto }).load('erp', 'ana-ruiz'), null);
});

test('remove borra el perfil', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage() });
  store.save('erp', 'ana-ruiz', values);
  store.remove('erp', 'ana-ruiz');
  assert.equal(store.load('erp', 'ana-ruiz'), null);
});
