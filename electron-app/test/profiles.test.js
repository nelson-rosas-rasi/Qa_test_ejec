const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listProfiles } = require('../main/profiles');

function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-profiles-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

test('lista los perfiles con su nombre y cargo', () => {
  const dir = repoWith({
    '.env.demo': 'QA_NOMBRE=Ana Ruiz\nQA_CARGO=QA Lead\nTEST_PASSWORD=secreta\n',
    '.env.otro': 'QA_NOMBRE=Beto Paz\nQA_CARGO=QA Tester\n',
  });
  assert.deepEqual(listProfiles(dir), [
    { id: 'demo', name: 'Ana Ruiz', role: 'QA Lead' },
    { id: 'otro', name: 'Beto Paz', role: 'QA Tester' },
  ]);
});

test('ignora .env.example', () => {
  const dir = repoWith({
    '.env.demo': 'QA_NOMBRE=Ana Ruiz\n',
    '.env.example': 'QA_NOMBRE=Plantilla\n',
  });
  assert.deepEqual(listProfiles(dir).map((p) => p.id), ['demo']);
});

test('nunca expone la contraseña', () => {
  const dir = repoWith({ '.env.demo': 'QA_NOMBRE=Ana\nTEST_PASSWORD=clave-falsa-NUNCA-filtrar\n' });
  assert.ok(!JSON.stringify(listProfiles(dir)).includes('clave-falsa'));
});

test('cae al id del perfil cuando falta QA_NOMBRE', () => {
  const dir = repoWith({ '.env.nelson': 'BASE_URL=https://ejemplo\n' });
  assert.deepEqual(listProfiles(dir), [{ id: 'nelson', name: 'nelson', role: 'QA' }]);
});

test('ignora comentarios y líneas sin =', () => {
  const dir = repoWith({ '.env.demo': '# QA_NOMBRE=Falso\nbasura\nQA_NOMBRE="Ana Ruiz"\n' });
  assert.equal(listProfiles(dir)[0].name, 'Ana Ruiz');
});

test('un repo sin perfiles lanza NO_PROFILE', () => {
  const dir = repoWith({ 'package.json': '{}' });
  assert.throws(() => listProfiles(dir), (err) => err.code === 'NO_PROFILE');
});
