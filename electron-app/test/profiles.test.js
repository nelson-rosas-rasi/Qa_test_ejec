const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSchema, readExistingProfiles } = require('../main/profiles');

function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-profiles-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

test('readSchema devuelve los campos del .env.example', () => {
  const dir = repoWith({ '.env.example': 'TEST_USERNAME=tu_usuario\nQA_CARGO=QA Tester\n' });
  assert.deepEqual(readSchema(dir), [
    { key: 'TEST_USERNAME', value: 'tu_usuario', help: '' },
    { key: 'QA_CARGO', value: 'QA Tester', help: '' },
  ]);
});

test('sin .env.example lanza PROFILE_TEMPLATE_MISSING', () => {
  const dir = repoWith({ 'package.json': '{}' });
  assert.throws(() => readSchema(dir), (err) => err.code === 'PROFILE_TEMPLATE_MISSING');
});

test('lee los perfiles existentes de un repositorio ya clonado', () => {
  const dir = repoWith({
    '.env.example': 'QA_NOMBRE=Tu nombre\n',
    '.env.nelson': '# Perfil local\nQA_NOMBRE=Nelson Rosas\nQA_CARGO=QA\nPASSWORD=secreta\n',
    '.env.ana': 'QA_NOMBRE=Ana Ruiz\nURL=https://example.test/?a=1&b=2\n',
    '.env': 'NO_ES_PERFIL=1\n',
  });

  assert.deepEqual(readExistingProfiles(dir), [
    { id: 'ana', values: { QA_NOMBRE: 'Ana Ruiz', URL: 'https://example.test/?a=1&b=2' } },
    { id: 'nelson', values: { QA_NOMBRE: 'Nelson Rosas', QA_CARGO: 'QA', PASSWORD: 'secreta' } },
  ]);
});

test('ignora perfiles vacíos y repositorios sin perfiles', () => {
  const dir = repoWith({ '.env.example': 'QA_NOMBRE=Tu nombre\n', '.env.vacio': '# sin datos\n' });
  assert.deepEqual(readExistingProfiles(dir), []);
  assert.deepEqual(readExistingProfiles(path.join(dir, 'no-existe')), []);
});
