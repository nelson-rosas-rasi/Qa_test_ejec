const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOutbox } = require('../main/server/queue');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-outbox-'));
const rec = (runId, over = {}) => ({ runId, repoUrl: 'https://git/x.git', discardedByQa: false, ...over });

test('enqueue y list hacen ida y vuelta', () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const items = box.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].runId, 'run-1');
});

test('list ordena por enqueuedAt ascendente e ignora JSON roto', () => {
  const dir = tempDir();
  const box = createOutbox({ dir });
  box.enqueue(rec('run-1'));
  box.enqueue(rec('run-2'));
  fs.writeFileSync(path.join(dir, 'roto.json'), '{ no json');
  assert.deepEqual(box.list().map((r) => r.runId), ['run-1', 'run-2']);
});

test('remove borra el ítem', () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  box.remove('run-1');
  assert.equal(box.list().length, 0);
});

test('sobrevive a recrear el store (persistencia en disco)', () => {
  const dir = tempDir();
  createOutbox({ dir }).enqueue(rec('run-1'));
  assert.equal(createOutbox({ dir }).list().length, 1);
});

test('setDiscarded actualiza el ítem encolado', () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1', { discardedByQa: false }));
  box.setDiscarded('run-1', true);
  assert.equal(box.list()[0].discardedByQa, true);
});

test('setDiscarded sobre un ítem ya enviado (ausente) no rompe', () => {
  const box = createOutbox({ dir: tempDir() });
  assert.doesNotThrow(() => box.setDiscarded('run-inexistente', true));
});

test('el tope descarta los más antiguos', () => {
  const box = createOutbox({ dir: tempDir(), maxItems: 2 });
  box.enqueue(rec('run-1'));
  box.enqueue(rec('run-2'));
  const descartados = box.enqueue(rec('run-3'));
  const ids = box.list().map((r) => r.runId);
  assert.equal(ids.length, 2);
  assert.equal(ids.includes('run-1'), false); // el más viejo se fue
  assert.equal(descartados, 1);
});
