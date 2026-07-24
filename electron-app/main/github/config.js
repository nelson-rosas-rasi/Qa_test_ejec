/**
 * Configuración de la OAuth App de GitHub. El client_id del device flow es
 * público (no hay secreto de cliente), así que puede compilarse y distribuirse.
 *
 * La variable de entorno permite reemplazarlo en desarrollo sin cambiar código.
 */
const CLIENT_ID_FALLBACK = 'Ov23liMOkAFDVIiaEjL6';
const SCOPE = 'repo';

function readGithubConfig(env = process.env) {
  return { clientId: env.QA_GITHUB_CLIENT_ID || CLIENT_ID_FALLBACK, scope: SCOPE };
}

module.exports = { readGithubConfig };
