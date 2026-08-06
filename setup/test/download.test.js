const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadTo } = require('../main/download');

const CONTENIDO = Buffer.from('contenido de prueba');
const HASH = crypto.createHash('sha256').update(CONTENIDO).digest('hex');

const fetchFake = () => Promise.resolve({
  ok: true,
  status: 200,
  headers: new Map([['content-length', String(CONTENIDO.length)]]),
  arrayBuffer: () => Promise.resolve(CONTENIDO),
});

function tempDest(nombre) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runqa-setup-')), nombre);
}

test('descarga, verifica el hash y devuelve la ruta', async () => {
  const dest = tempDest('archivo.bin');
  const progreso = [];
  const ruta = await downloadTo({
    url: 'https://ejemplo/archivo.bin', dest, sha256: HASH,
    onProgress: (p) => progreso.push(p), fetchImpl: fetchFake,
  });
  assert.equal(ruta, dest);
  assert.deepEqual(fs.readFileSync(dest), CONTENIDO);
  assert.equal(progreso.at(-1), 100);
});

test('un hash distinto borra el archivo y avisa que se corrompió', async () => {
  const dest = tempDest('archivo.bin');
  await assert.rejects(
    () => downloadTo({ url: 'https://ejemplo/archivo.bin', dest, sha256: 'a'.repeat(64), fetchImpl: fetchFake }),
    (err) => err.code === 'DOWNLOAD_CORRUPTED',
  );
  assert.equal(fs.existsSync(dest), false);
});

test('una respuesta con error nombra el servidor que falló', async () => {
  const dest = tempDest('archivo.bin');
  const fetchError = () => Promise.resolve({ ok: false, status: 503, headers: new Map() });
  await assert.rejects(
    () => downloadTo({ url: 'https://nodejs.org/dist/x.msi', dest, sha256: HASH, fetchImpl: fetchError }),
    (err) => err.code === 'DOWNLOAD_FAILED' && err.message.includes('nodejs.org'),
  );
});
