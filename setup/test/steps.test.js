const test = require('node:test');
const assert = require('node:assert/strict');
const { planSteps } = require('../main/steps');

const completo = {
  git: { ok: true }, node: { ok: true }, npm: { ok: true }, browsers: { ok: true },
};
const vacio = {
  git: { ok: false }, node: { ok: false }, npm: { ok: false }, browsers: { ok: false },
};

test('en una máquina limpia planifica los cuatro pasos', () => {
  assert.deepEqual(planSteps(vacio).map((s) => s.id), ['git', 'node', 'browsers', 'runqa']);
  assert.ok(planSteps(vacio).every((s) => s.status === 'pending'));
});

test('lo ya instalado queda marcado como hecho, no se repite', () => {
  const pasos = planSteps({ ...vacio, git: { ok: true } });
  assert.equal(pasos.find((s) => s.id === 'git').status, 'done');
  assert.equal(pasos.find((s) => s.id === 'node').status, 'pending');
});

test('Node cuenta como hecho sólo si también está npm', () => {
  const pasos = planSteps({ ...vacio, node: { ok: true }, npm: { ok: false } });
  assert.equal(pasos.find((s) => s.id === 'node').status, 'pending');
});

test('instalar RunQA es siempre el último paso y nunca se salta', () => {
  const pasos = planSteps(completo);
  assert.equal(pasos.at(-1).id, 'runqa');
  assert.equal(pasos.at(-1).status, 'pending');
});

test('cada paso trae un texto para el QA, sin jerga', () => {
  for (const paso of planSteps(vacio)) {
    assert.ok(paso.label.length > 0);
    assert.doesNotMatch(paso.label, /PATH|spawn|MSI|shell/i);
  }
});
