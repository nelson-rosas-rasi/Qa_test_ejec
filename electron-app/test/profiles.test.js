const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSchema } = require('../main/profiles');

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
