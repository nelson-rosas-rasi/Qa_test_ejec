const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesLocalDate } = require('../main/results/filter');

const iso = '2026-07-14T16:55:00.000Z';
const local = (() => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

test('sin fecha, no filtra', () => {
  assert.equal(matchesLocalDate(iso, ''), true);
  assert.equal(matchesLocalDate(iso, null), true);
});

test('coincide con la fecha local de la corrida', () => {
  assert.equal(matchesLocalDate(iso, local), true);
});

test('no coincide con otra fecha', () => {
  assert.equal(matchesLocalDate(iso, '1999-01-01'), false);
});

test('fecha inválida no coincide', () => {
  assert.equal(matchesLocalDate('no-es-fecha', '2026-07-14'), false);
});
