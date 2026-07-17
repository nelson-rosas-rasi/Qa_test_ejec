const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnvExample } = require('../main/profiles/schema');

test('cada CLAVE=valor es un campo con su valor por defecto', () => {
  const fields = parseEnvExample('TEST_USERNAME=tu_usuario\nQA_CARGO=QA Tester\n');
  assert.deepEqual(fields, [
    { key: 'TEST_USERNAME', value: 'tu_usuario', help: '' },
    { key: 'QA_CARGO', value: 'QA Tester', help: '' },
  ]);
});

test('acepta claves con dígitos (N8N_WEBHOOK_URL, GOOGLE_TEMPLATE_DOC_ID)', () => {
  const fields = parseEnvExample('N8N_WEBHOOK_URL=https://x\nGOOGLE_TEMPLATE_DOC_ID=abc123\n');
  assert.deepEqual(fields.map((f) => f.key), ['N8N_WEBHOOK_URL', 'GOOGLE_TEMPLATE_DOC_ID']);
});

test('los comentarios de arriba se vuelven la ayuda del campo', () => {
  const fields = parseEnvExample('# Nombre completo del profesional\nPROFESIONAL_NOMBRE=Nombre Apellido\n');
  assert.equal(fields[0].help, 'Nombre completo del profesional');
});

test('varias líneas de comentario se unen', () => {
  const fields = parseEnvExample('# Documento del paciente\n# vinculado al profesional\nPACIENTE_DOCUMENTO=00998877\n');
  assert.equal(fields[0].help, 'Documento del paciente vinculado al profesional');
});

test('un separador decorativo no genera campo ni contamina la ayuda del siguiente', () => {
  const fields = parseEnvExample('# ─── Horas por módulo ───\nATOD_HORA=07:00\n');
  assert.equal(fields.length, 1);
  assert.equal(fields[0].key, 'ATOD_HORA');
  assert.equal(fields[0].help, '');
});

test('una línea en blanco corta la ayuda: no se arrastra a un campo lejano', () => {
  const fields = parseEnvExample('# comentario suelto\n\nBASE_URL=https://x\n');
  assert.equal(fields[0].help, '');
});

test('un valor vacío es un campo válido', () => {
  const fields = parseEnvExample('ATENCION_HORA=\n');
  assert.deepEqual(fields, [{ key: 'ATENCION_HORA', value: '', help: '' }]);
});

test('un valor con = dentro (URL con query) se conserva entero', () => {
  const fields = parseEnvExample('BASE_URL=https://x/?a=1&b=2\n');
  assert.equal(fields[0].value, 'https://x/?a=1&b=2');
});
