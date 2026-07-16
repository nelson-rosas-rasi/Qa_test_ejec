const { appError } = require('../errors');

const USER_URL = 'https://api.github.com/user';

/**
 * Distinguir "el token ya no vale" (401) de "no hay red" es lo que sostiene el
 * modelo de estado: el primero desconecta la cuenta, el segundo la deja
 * conectada con la identidad cacheada. Colapsarlos rompe el caso sin internet.
 */
async function fetchIdentity({ token, fetch: fetchFn = fetch }) {
  let response;
  try {
    response = await fetchFn(USER_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
  } catch {
    throw appError('GITHUB_UNREACHABLE', 'No se pudo contactar con GitHub. Revisa tu conexión.');
  }
  if (response.status === 401) {
    throw appError('GITHUB_TOKEN_INVALID', 'Tu cuenta dejó de estar conectada. Conéctala de nuevo.');
  }
  if (!response.ok) {
    throw appError('GITHUB_UNREACHABLE', 'No se pudo contactar con GitHub. Revisa tu conexión.');
  }
  const data = await response.json();
  return { login: data.login, name: data.name || data.login, avatarUrl: data.avatar_url };
}

module.exports = { fetchIdentity };
