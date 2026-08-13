/**
 * El bloque «Reporte N8N → Google Drive» del `.env` es un ajuste de PROYECTO,
 * compartido por todos sus perfiles (cada proyecto tiene su propio flujo, su
 * plantilla y su carpeta). Por eso no se pide por perfil: se configura una vez
 * en Configuración y se inyecta al materializar el `.env.<perfil>` que lee
 * Playwright. Puro y testeable.
 *
 * **No se leen del `.env.example` del repo.** El formulario de perfil sí se arma
 * de ahí, y ni `medical-e2e` ni `rasierp-e2e` declaran `GOOGLE_DRIVE_FOLDER_ID`:
 * la carpeta de Drive nunca llegaba a aparecer. RunQA conoce el bloque y lo
 * escribe exista o no en el ejemplo del repo.
 *
 * `QA_NOMBRE` y `QA_CARGO` quedan afuera a propósito: firman el reporte
 * (`ejecutadoPor`, `firma.elaboradoPor`), así que son de cada persona.
 */

/** Clave del webhook de n8n en el `.env`. Debe coincidir con la del renderer. */
const N8N_ENV_KEY = 'N8N_WEBHOOK_URL';

/** El bloque completo, en el orden en que se muestra en el modal. */
const N8N_KEYS = [
  N8N_ENV_KEY,
  'GOOGLE_TEMPLATE_DOC_ID',
  'GOOGLE_DRIVE_FOLDER_ID',
  'AMBIENTE',
  'ERP_VERSION',
];

/** Deja sólo las claves del bloque con valor real, recortadas. */
function soloDelBloque(ajustes) {
  const out = {};
  for (const key of N8N_KEYS) {
    const valor = String((ajustes && ajustes[key]) || '').trim();
    if (valor) out[key] = valor;
  }
  return out;
}

/**
 * Devuelve los valores del perfil con el bloque del proyecto inyectado. Las
 * claves que el proyecto no tenga configuradas se quitan, para que un valor
 * viejo del perfil no se cuele en el `.env`. No muta la entrada.
 */
function withProjectN8n(values, ajustes) {
  const rest = { ...values };
  for (const key of N8N_KEYS) delete rest[key];
  return { ...rest, ...soloDelBloque(ajustes) };
}

/**
 * Lee el bloque de un proyecto del `config.json`, aceptando el formato viejo:
 * antes sólo se guardaba la URL, suelta en `project.n8nWebhookUrl`.
 */
function migrarAjustesN8n(project) {
  const viejo = project && project.n8nWebhookUrl;
  const base = viejo ? { [N8N_ENV_KEY]: viejo } : {};
  return soloDelBloque({ ...base, ...((project && project.n8n) || {}) });
}

module.exports = { N8N_ENV_KEY, N8N_KEYS, withProjectN8n, migrarAjustesN8n };
