/**
 * El webhook de n8n es un ajuste de PROYECTO, compartido por todos sus perfiles
 * (cada proyecto tiene su propio flujo). Por eso no se pide por perfil: se inyecta
 * al materializar el `.env.<perfil>` que lee Playwright. Puro y testeable.
 */

/** Clave del webhook de n8n en el `.env`. Debe coincidir con la del renderer. */
const N8N_ENV_KEY = 'N8N_WEBHOOK_URL';

/**
 * Devuelve los valores del perfil con la URL de n8n del proyecto inyectada.
 * Si el proyecto no tiene URL, quita la clave (no se hereda de valores viejos).
 * No muta la entrada.
 */
function withProjectN8n(values, projectUrl) {
  const rest = { ...values };
  delete rest[N8N_ENV_KEY];
  return projectUrl ? { ...rest, [N8N_ENV_KEY]: projectUrl } : rest;
}

module.exports = { N8N_ENV_KEY, withProjectN8n };
