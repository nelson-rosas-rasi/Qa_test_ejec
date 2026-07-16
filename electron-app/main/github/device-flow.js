const { appError } = require('../errors');

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

function unreachable() {
  return appError('GITHUB_UNREACHABLE', 'No se pudo contactar con GitHub. Revisa tu conexión.');
}

async function postJson(fetchFn, url, body) {
  let response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw unreachable();
  }
  if (!response.ok) throw unreachable();
  return response.json();
}

async function requestDeviceCode({ clientId, scope = 'repo', fetch: fetchFn = fetch }) {
  const data = await postJson(fetchFn, DEVICE_CODE_URL, { client_id: clientId, scope });
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval ?? 5,
    expiresIn: data.expires_in ?? 900,
  };
}

function cancelled() {
  return appError('GITHUB_CONNECT_CANCELLED', 'Se canceló la conexión.');
}

async function pollForToken({ clientId, deviceCode, interval = 5, expiresIn = 900, fetch: fetchFn = fetch, sleep, signal }) {
  const deadline = Date.now() + expiresIn * 1000;
  let waitMs = interval * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw cancelled();
    await sleep(waitMs);
    if (signal?.aborted) throw cancelled();

    const data = await postJson(fetchFn, TOKEN_URL, {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    // Ignorar slow_down hace que GitHub corte el flujo entero.
    if (data.error === 'slow_down') { waitMs = (data.interval ?? interval + 5) * 1000; continue; }
    if (data.error === 'expired_token') break;
    if (data.error === 'access_denied') {
      throw appError('GITHUB_ACCESS_DENIED', 'No se autorizó el acceso. Puedes intentarlo otra vez.');
    }
    throw appError('GITHUB_CONNECT_FAILED', 'No fue posible conectar la cuenta.');
  }

  throw appError('GITHUB_CODE_EXPIRED', 'El código caducó. Vuelve a intentarlo.');
}

module.exports = { requestDeviceCode, pollForToken, postJson, unreachable };
