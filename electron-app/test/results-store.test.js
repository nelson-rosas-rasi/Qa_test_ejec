const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createResultsStore, deriveMode } = require('../main/results/store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-results-'));
}
function sampleRecord(over = {}) {
  return {
    id: 'run-1000', projectId: 'erp', projectName: 'ERP',
    finishedAt: '2026-07-22T10:00:00.000Z',
    summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    tests: [{ id: 'a.spec.ts:1', name: 'a', status: 'passed', durationMs: 10, error: null }],
    ...over,
  };
}

test('deriveMode: 1 test es individual, varios o todos es conjunto', () => {
  assert.equal(deriveMode(['a:1'], false), 'individual');
  assert.equal(deriveMode(['a:1', 'b:2'], false), 'conjunto');
  assert.equal(deriveMode([], true), 'conjunto');
});

test('save y get hacen ida y vuelta', () => {
  const dir = tempDir();
  const store = createResultsStore({ dir });
  store.save(sampleRecord());
  assert.deepEqual(store.get('erp', 'run-1000'), sampleRecord());
});

test('save es idempotente por id (no duplica)', () => {
  const dir = tempDir();
  const store = createResultsStore({ dir });
  store.save(sampleRecord({ summary: { total: 1, passed: 0, failed: 1, skipped: 0 } }));
  store.save(sampleRecord()); // mismo id, distinto contenido
  assert.equal(store.list('erp').length, 1);
  assert.equal(store.get('erp', 'run-1000').summary.passed, 1);
});

test('list ordena por finishedAt desc y omite JSON ilegibles', () => {
  const dir = tempDir();
  const store = createResultsStore({ dir });
  store.save(sampleRecord({ id: 'run-1', finishedAt: '2026-07-20T10:00:00.000Z' }));
  store.save(sampleRecord({ id: 'run-2', finishedAt: '2026-07-22T10:00:00.000Z' }));
  fs.writeFileSync(path.join(dir, 'erp', 'run-3.json'), '{ roto');
  const ids = store.list('erp').map((r) => r.id);
  assert.deepEqual(ids, ['run-2', 'run-1']);
});

test('list de un proyecto sin corridas es vacío', () => {
  assert.deepEqual(createResultsStore({ dir: tempDir() }).list('nada'), []);
});

test('remove borra el JSON y la carpeta del reporte', () => {
  const dir = tempDir();
  const store = createResultsStore({ dir });
  store.save(sampleRecord());
  fs.mkdirSync(store.reportDir('erp', 'run-1000'), { recursive: true });
  fs.writeFileSync(store.reportIndex('erp', 'run-1000'), '<html></html>');
  store.remove('erp', 'run-1000');
  assert.equal(store.get('erp', 'run-1000'), null);
  assert.equal(fs.existsSync(store.runDir('erp', 'run-1000')), false);
});
