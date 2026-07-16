/**
 * Configuración de la OAuth App de GitHub. El client_id del device flow es
 * público (no hay secreto de cliente), así que puede compilarse y distribuirse.
 *
 * Mientras la organización no registre la app, queda vacío y `github:connect`
 * lo dice con un mensaje claro en vez de fallar de forma rara.
 */
const CLIENT_ID_FALLBACK = '';
const SCOPE = 'repo';

function readGithubConfig(env = process.env) {
  return { clientId: env.QA_GITHUB_CLIENT_ID || CLIENT_ID_FALLBACK, scope: SCOPE };
}

module.exports = { readGithubConfig };
