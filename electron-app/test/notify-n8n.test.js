const test = require('node:test');
const assert = require('node:assert/strict');
const { notifyN8n } = require('../main/results/notify-n8n');

const payload = { templateDocId: 'plantilla-1', resumen: { totalTests: 1 } };

/** Respuesta como la que devuelve n8n, que contesta con un array de un elemento. */
function respuesta({ ok = true, status = 200, body = '' } = {}) {
  return { ok, status, text: async () => body };
}

const DOC = 'https://docs.google.com/document/d/abc123/edit';
const CUERPO_OK = JSON.stringify([{ status: 'ok', message: 'Reporte creado exitosamente', documentId: 'abc123', documentUrl: DOC }]);

test('POST con el payload como cuerpo a la URL dada', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return respuesta({ body: CUERPO_OK }); };
  const res = await notifyN8n(payload, { url: 'https://n8n/webhook', fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, 'https://n8n/webhook');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].opts.body), payload);
  assert.ok(res.at);
});

test('devuelve el enlace del documento que generó n8n', async () => {
  const fetchImpl = async () => respuesta({ body: CUERPO_OK });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.docUrl, DOC);
});

test('un 200 sin documento NO cuenta como éxito', async () => {
  // Caso real: n8n acepta el webhook y falla en un nodo intermedio. Contesta 200
  // con el cuerpo vacío y no genera nada. Antes esto pintaba "documentación ✓".
  const fetchImpl = async () => respuesta({ body: '' });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.docUrl, null);
  assert.match(res.error, /no generó el documento/i);
});

test('un 200 con cuerpo pero sin enlace tampoco cuenta como éxito', async () => {
  const fetchImpl = async () => respuesta({ body: JSON.stringify([{ status: 'error', message: 'plantilla no encontrada' }]) });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /no generó el documento/i);
});

test('respuesta no-ok devuelve ok:false con el status', async () => {
  const fetchImpl = async () => respuesta({ ok: false, status: 500 });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /500/);
});

test('una excepción de red no se propaga', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /ECONNREFUSED/);
});

test('un cuerpo ilegible no rompe el envío', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => { throw new Error('stream roto'); } });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.ok(res.error);
});
