const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore } = require('../main/config-store');
const { createAccountStore } = require('../main/github/account');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-account-'));

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (value) => Buffer.from(`cifrado:${value}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^cifrado:/, ''),
});

const identity = { login: 'maria-gomez', name: 'María Gómez', avatarUrl: 'https://x/a.png' };

test('guarda y recupera la cuenta', () => {
  const dir = tempDir();
  createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() }).save('gho_secreto', identity);
  const loaded = createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() }).load();
  assert.equal(loaded.token, 'gho_secreto');
  assert.deepEqual(loaded.identity, identity);
});

test('el token no queda en claro en el config', () => {
  const dir = tempDir();
  createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() }).save('gho_secreto', identity);
  const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  assert.equal(raw.includes('gho_secreto'), false);
});

test('sin cuenta guardada devuelve null', () => {
  assert.equal(createAccountStore({ store: createConfigStore(tempDir()), safeStorage: fakeSafeStorage() }).load(), null);
});

test('sin cifrado disponible lanza y no escribe nada', () => {
  const dir = tempDir();
  const account = createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage(false) });
  assert.throws(() => account.save('gho_secreto', identity), (err) => err.code === 'SECURE_STORAGE_UNAVAILABLE');
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), false);
});

test('un token ilegible se trata como si no hubiera cuenta', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setSetting('github', { token: 'no-es-base64-válido-cifrado', identity });
  const safeStorage = { ...fakeSafeStorage(), decryptString: () => { throw new Error('DPAPI: otro usuario'); } };
  assert.equal(createAccountStore({ store, safeStorage }).load(), null);
});

test('clear borra la cuenta', () => {
  const dir = tempDir();
  const account = createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() });
  account.save('gho_secreto', identity);
  account.clear();
  assert.equal(account.load(), null);
});

test('saveIdentity refresca la caché sin tocar el token', () => {
  const dir = tempDir();
  const account = createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() });
  account.save('gho_secreto', identity);
  account.saveIdentity({ ...identity, name: 'María G. Rojas' });
  const loaded = account.load();
  assert.equal(loaded.token, 'gho_secreto');
  assert.equal(loaded.identity.name, 'María G. Rojas');
});
