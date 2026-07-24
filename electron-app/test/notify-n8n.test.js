const test = require('node:test');
const assert = require('node:assert/strict');
const { notifyN8n } = require('../main/results/notify-n8n');

const record = { id: 'run-1', projectId: 'erp', summary: { total: 1 } };

test('POST con el registro como cuerpo a la URL dada', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
  const res = await notifyN8n(record, { url: 'https://n8n/webhook', fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, 'https://n8n/webhook');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].opts.body), record);
  assert.ok(res.at);
});

test('respuesta no-ok devuelve ok:false con el status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  const res = await notifyN8n(record, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /500/);
});

test('una excepción de red no se propaga', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const res = await notifyN8n(record, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /ECONNREFUSED/);
});
