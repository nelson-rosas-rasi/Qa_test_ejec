const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOutbox } = require('../main/server/queue');
const { createSender } = require('../main/server/sender');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-sender-'));
const rec = (runId) => ({ runId, repoUrl: 'https://git/x.git' });

function clientThatAlways(result, calls = []) {
  return { postRun: async (token, record) => { calls.push({ token, runId: record.runId }); return result; } };
}

test('drena y borra lo enviado, en orden', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1')); box.enqueue(rec('run-2'));
  const calls = [];
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: true, created: true }, calls), getToken: () => 'tok' });
  const r = await sender.drain();
  assert.equal(r.sent, 2);
  assert.equal(box.list().length, 0);
  assert.deepEqual(calls.map((c) => c.runId), ['run-1', 'run-2']);
});

test('un 204 (ya existía) también saca el ítem de la cola', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: true, created: false }), getToken: () => 'tok' });
  await sender.drain();
  assert.equal(box.list().length, 0);
});

test('sin red se detiene y conserva la cola', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: false, code: 'NETWORK' }), getToken: () => 'tok' });
  const r = await sender.drain();
  assert.equal(r.sent, 0);
  assert.equal(r.stoppedBy, 'NETWORK');
  assert.equal(box.list().length, 1);
});

test('sin token no intenta enviar', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const calls = [];
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: true, created: true }, calls), getToken: () => null });
  const r = await sender.drain();
  assert.equal(calls.length, 0);
  assert.equal(r.stoppedBy, 'NO_TOKEN');
  assert.equal(box.list().length, 1);
});

test('UNAUTHORIZED se detiene sin borrar (hay que re-login)', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: false, code: 'UNAUTHORIZED' }), getToken: () => 'tok' });
  const r = await sender.drain();
  assert.equal(r.stoppedBy, 'UNAUTHORIZED');
  assert.equal(box.list().length, 1);
});

test('pending() cuenta lo encolado', () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: true }), getToken: () => 'tok' });
  assert.equal(sender.pending(), 1);
});
