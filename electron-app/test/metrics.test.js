const test = require('node:test');
const assert = require('node:assert/strict');
const { testHistory } = require('../main/results/metrics');

function record(id, finishedAt, testId, status, error = null) {
  return { id, finishedAt, tests: [{ id: testId, name: testId, status, error }] };
}

const TID = 'login.spec.ts:22';
const records = [
  record('r1', '2026-07-18T10:00:00Z', TID, 'passed'),
  record('r2', '2026-07-19T10:00:00Z', TID, 'failed', 'timeout esperando #submit'),
  record('r3', '2026-07-20T10:00:00Z', TID, 'failed', 'timeout esperando #submit'),
  record('r4', '2026-07-21T10:00:00Z', 'otro.spec.ts:1', 'passed'), // no aparece TID
  record('r5', '2026-07-22T10:00:00Z', TID, 'failed', 'elemento no encontrado'),
];

test('cuenta corridas y fallos solo donde aparece el test', () => {
  const h = testHistory(records, TID);
  assert.equal(h.runs, 4);
  assert.equal(h.failures, 3);
  assert.equal(Math.round(h.failRate * 100), 75);
});

test('lastFailureAt es la fecha del último fallo', () => {
  assert.equal(testHistory(records, TID).lastFailureAt, '2026-07-22T10:00:00Z');
});

test('timeline es cronológico, pass/fail, máximo 10', () => {
  assert.deepEqual(testHistory(records, TID).timeline, ['pass', 'fail', 'fail', 'fail']);
});

test('topError es el mensaje más frecuente con su conteo', () => {
  assert.deepEqual(testHistory(records, TID).topError, { message: 'timeout esperando #submit', count: 2 });
});

test('un test sin apariciones da métricas en cero', () => {
  const h = testHistory(records, 'inexistente:1');
  assert.equal(h.runs, 0);
  assert.equal(h.failRate, 0);
  assert.equal(h.lastFailureAt, null);
  assert.equal(h.topError, null);
});
