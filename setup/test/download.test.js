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

test('una URL malformada rechaza con DOWNLOAD_FAILED', async () => {
  const dest = tempDest('archivo.bin');
  await assert.rejects(
    () => downloadTo({ url: 'no-es-una-url', dest, sha256: HASH, fetchImpl: fetchFake }),
    (err) => err.code === 'DOWNLOAD_FAILED',
  );
});

test('un fallo de escritura rechaza con DOWNLOAD_WRITE_FAILED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runqa-setup-'));
  const archivo = path.join(tmpDir, 'bloqueador');
  fs.writeFileSync(archivo, 'contenido');
  const dest = path.join(archivo, 'no-puede-escribir.bin');
  await assert.rejects(
    () => downloadTo({ url: 'https://ejemplo/archivo.bin', dest, sha256: HASH, fetchImpl: fetchFake }),
    (err) => err.code === 'DOWNLOAD_WRITE_FAILED',
  );
});

test('con verify en false acepta el archivo sin hash conocido', async () => {
  const dest = tempDest('installer.exe');
  const ruta = await downloadTo({ url: 'https://ejemplo/installer.exe', dest, sha256: null, verify: false, fetchImpl: fetchFake });
  assert.equal(ruta, dest);
});

test('un archivo ya descargado y verificado no se vuelve a bajar', async () => {
  // El QA que reintenta cuatro veces bajaba cuatro veces los mismos 30 MB.
  const dest = tempDest('archivo.bin');
  fs.writeFileSync(dest, CONTENIDO);
  let llamadas = 0;
  const ruta = await downloadTo({
    url: 'https://ejemplo/archivo.bin', dest, sha256: HASH,
    fetchImpl: () => { llamadas += 1; return fetchFake(); },
  });
  assert.equal(ruta, dest);
  assert.equal(llamadas, 0, 'no debería haber pedido nada a la red');
});

test('un archivo a medio bajar se descarta y se baja de nuevo', async () => {
  const dest = tempDest('archivo.bin');
  fs.writeFileSync(dest, Buffer.from('descarga cortada'));
  let llamadas = 0;
  await downloadTo({
    url: 'https://ejemplo/archivo.bin', dest, sha256: HASH,
    fetchImpl: () => { llamadas += 1; return fetchFake(); },
  });
  assert.equal(llamadas, 1);
  assert.deepEqual(fs.readFileSync(dest), CONTENIDO);
});

test('sin hash con qué comparar, se baja igual', async () => {
  // El instalador de RunQA no trae sha256 publicado: reutilizar un archivo que
  // no se puede verificar sería confiar en su nombre, y el nombre no dice nada
  // de su contenido.
  const dest = tempDest('runqa.exe');
  fs.writeFileSync(dest, CONTENIDO);
  let llamadas = 0;
  await downloadTo({
    url: 'https://ejemplo/runqa.exe', dest, sha256: null, verify: false,
    fetchImpl: () => { llamadas += 1; return fetchFake(); },
  });
  assert.equal(llamadas, 1);
});
