const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectBaseUrl,
  draftFileName,
  profileDraftFolder,
  recordingRepoPath,
  sanitizeBranch,
} = require('../main/recordings/detect');

test('detectBaseUrl prefiere una clave con URL/BASE', () => {
  assert.equal(detectBaseUrl({ QA_NOMBRE: 'Ana', BASE_URL: 'https://app.test/', OTRO: 'x' }), 'https://app.test/');
});

test('detectBaseUrl cae a cualquier valor http si no hay clave preferida', () => {
  assert.equal(detectBaseUrl({ FOO: 'http://x.test' }), 'http://x.test');
});

test('detectBaseUrl vacío cuando no hay URL', () => {
  assert.equal(detectBaseUrl({ QA_NOMBRE: 'Ana' }), '');
  assert.equal(detectBaseUrl(null), '');
});

test('draftFileName hace slug y agrega .spec.ts', () => {
  assert.equal(draftFileName('Flujo de Atención'), 'flujo-de-atencion.spec.ts');
  assert.equal(draftFileName(''), 'grabacion.spec.ts');
});

test('profileDraftFolder conserva el id del perfil sin el prefijo .env', () => {
  assert.equal(profileDraftFolder('.env.nelson_vid'), 'nelson_vid');
  assert.equal(profileDraftFolder('Nelson Vid'), 'nelson-vid');
});

test('recordingRepoPath guarda cada grabación bajo el nombre actual del perfil', () => {
  assert.equal(
    recordingRepoPath('Nelson Rosas', 'Inicio de sesión'),
    'drafts/nelson-rosas/inicio-de-sesion.spec.ts',
  );
});

test('recordingRepoPath no permite salir de la carpeta drafts', () => {
  assert.equal(
    recordingRepoPath('../../QA Principal', 'Flujo de compra'),
    'drafts/qa-principal/flujo-de-compra.spec.ts',
  );
});

test('sanitizeBranch normaliza espacios y quita caracteres inválidos', () => {
  assert.equal(sanitizeBranch('  draft nueva rama '), 'draft-nueva-rama');
  assert.equal(sanitizeBranch('feat/login~x'), 'feat/loginx');
  assert.equal(sanitizeBranch('   '), '');
});

test('sanitizeBranch quita guiones iniciales (evita que se lea como opción de git)', () => {
  assert.equal(sanitizeBranch('--force'), 'force');
  assert.equal(sanitizeBranch('--receive-pack=x'), 'receive-pack=x');
  assert.equal(sanitizeBranch('-'), '');
});
