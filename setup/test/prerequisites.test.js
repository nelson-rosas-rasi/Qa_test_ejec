const test = require('node:test');
const assert = require('node:assert/strict');
const prerequisites = require('../prerequisites.json');

test('cada prerequisito descargable tiene versión, url https y sha256', () => {
  for (const key of ['git', 'node']) {
    const entry = prerequisites[key];
    assert.match(entry.version, /^\d+\.\d+\.\d+$/, `${key}: versión con formato x.y.z`);
    assert.match(entry.url, /^https:\/\//, `${key}: la url debe ser https`);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, `${key}: sha256 en minúsculas`);
  }
});

test('la versión de Playwright coincide con la del repo de pruebas de referencia', () => {
  const sample = require('../../electron-app/test-fixtures/sample-repo/package.json');
  const expected = sample.devDependencies['@playwright/test'];
  assert.equal(prerequisites.playwright.version, expected);
});

test('la url de Node apunta al instalador de la versión declarada', () => {
  assert.ok(prerequisites.node.url.includes(prerequisites.node.version));
  assert.match(prerequisites.node.url, /x64\.msi$/);
});

test('el asset de Git declarado coincide con el último segmento de la url', () => {
  const lastSegment = prerequisites.git.url.split('/').pop();
  assert.equal(prerequisites.git.asset, lastSegment);
});
