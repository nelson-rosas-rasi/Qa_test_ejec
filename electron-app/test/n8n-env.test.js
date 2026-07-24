const test = require('node:test');
const assert = require('node:assert/strict');
const { N8N_ENV_KEY, withProjectN8n } = require('../main/profiles/n8n-env');

test('N8N_ENV_KEY es la clave del webhook de n8n', () => {
  assert.equal(N8N_ENV_KEY, 'N8N_WEBHOOK_URL');
});

test('inyecta la URL del proyecto sobre el valor del perfil', () => {
  const out = withProjectN8n({ QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'vieja' }, 'https://proj/hook');
  assert.deepEqual(out, { QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'https://proj/hook' });
});

test('añade la clave cuando el perfil no la trae', () => {
  const out = withProjectN8n({ QA_NOMBRE: 'Ana' }, 'https://proj/hook');
  assert.deepEqual(out, { QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'https://proj/hook' });
});

test('sin URL de proyecto quita la clave (no se hereda de valores viejos)', () => {
  const out = withProjectN8n({ QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'vieja' }, '');
  assert.deepEqual(out, { QA_NOMBRE: 'Ana' });
});

test('url nula/indefinida se trata como sin URL', () => {
  assert.deepEqual(withProjectN8n({ N8N_WEBHOOK_URL: 'x' }, null), {});
  assert.deepEqual(withProjectN8n({ N8N_WEBHOOK_URL: 'x' }, undefined), {});
});

test('no muta el objeto de entrada', () => {
  const values = { QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'vieja' };
  withProjectN8n(values, 'https://proj/hook');
  assert.deepEqual(values, { QA_NOMBRE: 'Ana', N8N_WEBHOOK_URL: 'vieja' });
});
