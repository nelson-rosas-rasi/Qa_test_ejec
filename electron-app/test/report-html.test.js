const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fillTemplate, logoHtml } = require('../main/results/report-html');

test('fillTemplate reemplaza tokens presentes', () => {
  assert.equal(fillTemplate('a {{X}} b {{Y}}', { X: '1', Y: '2' }), 'a 1 b 2');
});

test('fillTemplate deja vacío el token ausente', () => {
  assert.equal(fillTemplate('a {{X}} b {{Y}}', { X: '1' }), 'a 1 b ');
});

test('fillTemplate acepta números y 0', () => {
  assert.equal(fillTemplate('{{N}}', { N: 0 }), '0');
});

test('logoHtml devuelve <img> data-uri cuando existe el png', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-logo-'));
  fs.writeFileSync(path.join(dir, 'rasi-logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const html = logoHtml(dir);
  assert.match(html, /^<img /);
  assert.match(html, /data:image\/png;base64,/);
});

test('logoHtml devuelve "" cuando falta el png', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-logo-'));
  assert.equal(logoHtml(dir), '');
});
