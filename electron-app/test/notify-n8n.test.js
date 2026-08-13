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

/* ---------- lo que se le muestra al QA para diagnosticar ---------- */

test('devuelve el código y el cuerpo crudo cuando el envío sale bien', async () => {
  const fetchImpl = async () => respuesta({ body: CUERPO_OK });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(res.body, CUERPO_OK);
});

test('devuelve el cuerpo crudo cuando n8n contesta 200 sin documento', async () => {
  // Es EL caso a diagnosticar: el flujo está mal configurado y lo único que lo
  // delata es lo que contestó el nodo que falló.
  const crudo = JSON.stringify([{ status: 'error', message: 'plantilla no encontrada' }]);
  const fetchImpl = async () => respuesta({ body: crudo });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.status, 200);
  assert.equal(res.body, crudo);
});

test('un 500 trae su código y su cuerpo', async () => {
  const fetchImpl = async () => respuesta({ ok: false, status: 500, body: 'Internal Server Error' });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.status, 500);
  assert.equal(res.body, 'Internal Server Error');
});

test('un fallo de red no tiene código pero sí deja el error', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.status, null);
  assert.equal(res.body, null);
  assert.match(res.error, /ECONNREFUSED/);
});

test('el cuerpo se recorta para no guardar una respuesta enorme en el registro', async () => {
  const largo = 'x'.repeat(5000);
  const fetchImpl = async () => respuesta({ body: largo });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.ok(res.body.length < largo.length);
  assert.ok(res.body.length <= 2100);
  assert.match(res.body, /recortada/i);
});

test('un cuerpo ilegible deja el código de todos modos', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => { throw new Error('stream roto'); } });
  const res = await notifyN8n(payload, { url: 'https://n8n', fetchImpl });
  assert.equal(res.status, 200);
});
