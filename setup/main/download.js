const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fallo(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function downloadTo({ url, dest, sha256, onProgress = () => {}, fetchImpl = fetch }) {
  const host = new URL(url).host;
  let respuesta;
  try {
    respuesta = await fetchImpl(url);
  } catch {
    throw fallo('DOWNLOAD_FAILED', `No hubo respuesta de ${host}. Revisá la conexión a internet.`);
  }
  if (!respuesta.ok) {
    throw fallo('DOWNLOAD_FAILED', `${host} respondió con un error (${respuesta.status}).`);
  }

  const datos = Buffer.from(await respuesta.arrayBuffer());
  onProgress(100);

  const hash = crypto.createHash('sha256').update(datos).digest('hex');
  if (hash !== sha256) {
    throw fallo('DOWNLOAD_CORRUPTED', 'La descarga se corrompió. Volvé a intentarlo.');
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, datos);
  return dest;
}

module.exports = { downloadTo };
