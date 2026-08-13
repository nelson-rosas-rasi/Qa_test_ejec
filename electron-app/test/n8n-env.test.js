const test = require('node:test');
const assert = require('node:assert/strict');
const { N8N_ENV_KEY, N8N_KEYS, withProjectN8n, migrarAjustesN8n } = require('../main/profiles/n8n-env');

test('N8N_ENV_KEY es la clave del webhook de n8n', () => {
  assert.equal(N8N_ENV_KEY, 'N8N_WEBHOOK_URL');
});

test('el bloque de proyecto son las claves del reporte a Drive, sin las de la persona', () => {
  assert.deepEqual(N8N_KEYS, [
    'N8N_WEBHOOK_URL',
    'GOOGLE_TEMPLATE_DOC_ID',
    'GOOGLE_DRIVE_FOLDER_ID',
    'AMBIENTE',
    'ERP_VERSION',
  ]);
  // QA_NOMBRE y QA_CARGO firman el reporte: son de cada perfil, no del proyecto.
  assert.ok(!N8N_KEYS.includes('QA_NOMBRE'));
  assert.ok(!N8N_KEYS.includes('QA_CARGO'));
});

test('inyecta los ajustes del proyecto sobre los valores del perfil', () => {
  const out = withProjectN8n(
    { QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'vieja' },
    { N8N_WEBHOOK_URL: 'https://proj/hook', GOOGLE_TEMPLATE_DOC_ID: 'plantilla-1' },
  );
  assert.deepEqual(out, {
    QA_NOMBRE: 'Ana',
    N8N_WEBHOOK_URL: 'https://proj/hook',
    GOOGLE_TEMPLATE_DOC_ID: 'plantilla-1',
  });
});

test('escribe la carpeta de Drive aunque el .env.example del repo no la declare', () => {
  // El bug: el formulario se arma del .env.example, que en medical-e2e y
  // rasierp-e2e no trae GOOGLE_DRIVE_FOLDER_ID. Ahora no depende de eso.
  const out = withProjectN8n({ QA_NOMBRE: 'Ana' }, { GOOGLE_DRIVE_FOLDER_ID: 'carpeta-1' });
  assert.equal(out.GOOGLE_DRIVE_FOLDER_ID, 'carpeta-1');
});

test('una clave vacía se quita (no se hereda de valores viejos)', () => {
  const out = withProjectN8n(
    { QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'vieja', AMBIENTE: 'viejo' },
    { N8N_WEBHOOK_URL: '', AMBIENTE: '   ' },
  );
  assert.deepEqual(out, { QA_NOMBRE: 'Ana' });
});

test('sin ajustes de proyecto se limpian todas las claves del bloque', () => {
  const values = { QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'x', GOOGLE_TEMPLATE_DOC_ID: 'y', ERP_VERSION: 'z' };
  assert.deepEqual(withProjectN8n(values, null), { QA_NOMBRE: 'Ana' });
  assert.deepEqual(withProjectN8n(values, undefined), { QA_NOMBRE: 'Ana' });
  assert.deepEqual(withProjectN8n(values, {}), { QA_NOMBRE: 'Ana' });
});

test('ignora claves ajenas al bloque que vengan en los ajustes', () => {
  const out = withProjectN8n({}, { N8N_WEBHOOK_URL: 'https://h', QA_NOMBRE: 'Impostora' });
  assert.deepEqual(out, { N8N_WEBHOOK_URL: 'https://h' });
});

test('no muta el objeto de entrada', () => {
  const values = { QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'vieja' };
  withProjectN8n(values, { N8N_WEBHOOK_URL: 'https://proj/hook' });
  assert.deepEqual(values, { QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'vieja' });
});

test('migra el ajuste viejo de una sola URL al bloque', () => {
  // Antes el proyecto guardaba `n8nWebhookUrl` suelto en config.json.
  assert.deepEqual(migrarAjustesN8n({ n8nWebhookUrl: 'https://vieja/hook' }), {
    N8N_WEBHOOK_URL: 'https://vieja/hook',
  });
});

test('el bloque nuevo manda sobre el ajuste viejo', () => {
  const out = migrarAjustesN8n({
    n8nWebhookUrl: 'https://vieja/hook',
    n8n: { N8N_WEBHOOK_URL: 'https://nueva/hook', GOOGLE_DRIVE_FOLDER_ID: 'carpeta-1' },
  });
  assert.deepEqual(out, { N8N_WEBHOOK_URL: 'https://nueva/hook', GOOGLE_DRIVE_FOLDER_ID: 'carpeta-1' });
});

test('un proyecto sin nada configurado migra a un bloque vacío', () => {
  assert.deepEqual(migrarAjustesN8n({}), {});
  assert.deepEqual(migrarAjustesN8n(undefined), {});
});

test('la migración descarta claves ajenas y valores en blanco', () => {
  const out = migrarAjustesN8n({ n8n: { N8N_WEBHOOK_URL: ' https://h ', AMBIENTE: '', QA_NOMBRE: 'Ana' } });
  assert.deepEqual(out, { N8N_WEBHOOK_URL: 'https://h' });
});
