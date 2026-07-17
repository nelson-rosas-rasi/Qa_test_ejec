const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeEnv, sweep } = require('../main/profiles/materialize');

const repoDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-mat-'));

test('writeEnv escribe .env.<id> con las claves del perfil', () => {
  const repo = repoDir();
  writeEnv({ repoPath: repo, id: 'ana', values: { TEST_USERNAME: 'ana', TEST_PASSWORD: 'x' } });
  const content = fs.readFileSync(path.join(repo, '.env.ana'), 'utf8');
  assert.match(content, /^TEST_USERNAME=ana$/m);
  assert.match(content, /^TEST_PASSWORD=x$/m);
});

test('sweep borra los .env.* materializados', () => {
  const repo = repoDir();
  fs.writeFileSync(path.join(repo, '.env.ana'), 'x');
  fs.writeFileSync(path.join(repo, '.env.beto'), 'x');
  sweep(repo);
  assert.equal(fs.existsSync(path.join(repo, '.env.ana')), false);
  assert.equal(fs.existsSync(path.join(repo, '.env.beto')), false);
});

test('sweep NUNCA borra .env.example', () => {
  const repo = repoDir();
  fs.writeFileSync(path.join(repo, '.env.example'), 'plantilla');
  fs.writeFileSync(path.join(repo, '.env.ana'), 'x');
  sweep(repo);
  assert.equal(fs.existsSync(path.join(repo, '.env.example')), true);
  assert.equal(fs.existsSync(path.join(repo, '.env.ana')), false);
});

test('sweep no toca archivos que no son .env.*', () => {
  const repo = repoDir();
  fs.writeFileSync(path.join(repo, 'package.json'), '{}');
  fs.writeFileSync(path.join(repo, '.env'), 'base'); // .env pelado, sin sufijo
  sweep(repo);
  assert.equal(fs.existsSync(path.join(repo, 'package.json')), true);
  assert.equal(fs.existsSync(path.join(repo, '.env')), true);
});

test('sweep sobre una carpeta sin .env.* no falla', () => {
  assert.doesNotThrow(() => sweep(repoDir()));
});

test('sweep sobre una carpeta inexistente no falla', () => {
  assert.doesNotThrow(() => sweep(path.join(os.tmpdir(), 'no-existe-qatr')));
});

test('lo que escribe writeEnv lo puede releer un parser de env', () => {
  const repo = repoDir();
  writeEnv({ repoPath: repo, id: 'ana', values: { BASE_URL: 'https://x/?a=1&b=2', VACIO: '' } });
  const parsed = {};
  for (const line of fs.readFileSync(path.join(repo, '.env.ana'), 'utf8').split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) parsed[line.slice(0, eq)] = line.slice(eq + 1);
  }
  assert.equal(parsed.BASE_URL, 'https://x/?a=1&b=2');
  assert.equal(parsed.VACIO, '');
});
