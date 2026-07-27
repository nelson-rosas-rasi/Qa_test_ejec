const test = require('node:test');
const assert = require('node:assert/strict');
const { createServerSession } = require('../main/server/session');

// Store en memoria que imita config-store (getSetting/setSetting).
function fakeStore() {
  const data = {};
  return {
    getSetting: (k) => data[k],
    setSetting: (k, v) => { if (v === null || v === undefined) delete data[k]; else data[k] = v; },
  };
}
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (v) => Buffer.from(`cif:${v}`, 'utf8'),
  decryptString: (b) => b.toString('utf8').replace(/^cif:/, ''),
});

// JWT de juguete: header.payload.firma, payload base64url con { exp }.
function jwtWithExp(expSeconds) {
  const payload = Buffer.from(JSON.stringify({ sub: 'ana', exp: expSeconds })).toString('base64url');
  return `h.${payload}.s`;
}

test('guarda y recupera la sesión', () => {
  const store = fakeStore();
  const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  createServerSession({ store, safeStorage: fakeSafeStorage() }).save(token, { username: 'ana', role: 'QA_ANALYST' });
  const loaded = createServerSession({ store, safeStorage: fakeSafeStorage() }).load();
  assert.equal(loaded.token, token);
  assert.equal(loaded.user.username, 'ana');
});

test('el token no queda en claro en el store', () => {
  const store = fakeStore();
  const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  createServerSession({ store, safeStorage: fakeSafeStorage() }).save(token, { username: 'ana' });
  assert.equal(JSON.stringify(store.getSetting('serverSession')).includes(token), false);
});

test('sin sesión devuelve null', () => {
  assert.equal(createServerSession({ store: fakeStore(), safeStorage: fakeSafeStorage() }).load(), null);
});

test('cifrado de otra cuenta de Windows -> load devuelve null, no rompe', () => {
  const store = fakeStore();
  createServerSession({ store, safeStorage: fakeSafeStorage() }).save(jwtWithExp(9999999999), { username: 'ana' });
  const roto = { ...fakeSafeStorage(), decryptString: () => { throw new Error('otra cuenta'); } };
  assert.equal(createServerSession({ store, safeStorage: roto }).load(), null);
});

test('isExpired: futuro es false, pasado es true', () => {
  const s = createServerSession({ store: fakeStore(), safeStorage: fakeSafeStorage() });
  assert.equal(s.isExpired(jwtWithExp(Math.floor(Date.now() / 1000) + 3600)), false);
  assert.equal(s.isExpired(jwtWithExp(Math.floor(Date.now() / 1000) - 10)), true);
});

test('isExpired: un token ilegible es tratado como expirado', () => {
  const s = createServerSession({ store: fakeStore(), safeStorage: fakeSafeStorage() });
  assert.equal(s.isExpired('no-es-jwt'), true);
});

test('clear borra la sesión', () => {
  const store = fakeStore();
  const s = createServerSession({ store, safeStorage: fakeSafeStorage() });
  s.save(jwtWithExp(9999999999), { username: 'ana' });
  s.clear();
  assert.equal(s.load(), null);
});
