const { appError } = require('../errors');

const DEVICE_CODE_URL = 'https://github.com/login/device/code';

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

module.exports = { requestDeviceCode, postJson, unreachable };
