const test = require('node:test');
const assert = require('node:assert/strict');
const { latestInstaller } = require('../main/releases');

const runqa = {
  tag_name: 'v1.6.0',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'latest.yml', browser_download_url: 'https://ejemplo/latest.yml' },
    { name: 'runqa-1.6.0-x64.nsis.7z', browser_download_url: 'https://ejemplo/paquete.7z' },
    { name: 'RunQA-Installer-1.6.0.exe', browser_download_url: 'https://ejemplo/RunQA-Installer-1.6.0.exe' },
  ],
};

/** El release del propio Setup: vive en el mismo repo y no instala RunQA. */
const setup = {
  tag_name: 'setup-v1.0.0',
  draft: false,
  prerelease: false,
  assets: [{ name: 'RunQA.Setup.1.0.0.exe', browser_download_url: 'https://ejemplo/RunQA.Setup.1.0.0.exe' }],
};

const fetchCon = (cuerpo, ok = true) => () => Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(cuerpo) });

test('elige el instalador entre todos los archivos del release', async () => {
  const info = await latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon([runqa]) });
  assert.equal(info.name, 'RunQA-Installer-1.6.0.exe');
  assert.equal(info.url, 'https://ejemplo/RunQA-Installer-1.6.0.exe');
  assert.equal(info.version, '1.6.0');
});

/**
 * El caso que rompió producción: al publicar RunQA Setup en el mismo repo, su
 * release pasó a ser el más reciente y `/releases/latest` devolvía uno cuyo
 * único archivo no es el instalador de RunQA. El último paso del setup —el que
 * instala RunQA— empezó a fallar en todos los equipos. Buscar el release más
 * nuevo que SÍ traiga instalador es lo que hace a esto inmune a lo que se
 * publique al lado.
 */
test('saltea el release del propio Setup y toma el de RunQA', async () => {
  const info = await latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon([setup, runqa]) });
  assert.equal(info.name, 'RunQA-Installer-1.6.0.exe');
  assert.equal(info.version, '1.6.0');
});

test('toma el primero de la lista, que es el más reciente', async () => {
  const viejo = { ...runqa, tag_name: 'v1.5.1', assets: [{ name: 'RunQA-Installer-1.5.1.exe', browser_download_url: 'https://ejemplo/vieja.exe' }] };
  const info = await latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon([setup, runqa, viejo]) });
  assert.equal(info.version, '1.6.0');
});

test('ignora borradores y versiones preliminares', async () => {
  const borrador = { ...runqa, tag_name: 'v1.7.0', draft: true, assets: [{ name: 'RunQA-Installer-1.7.0.exe', browser_download_url: 'https://ejemplo/borrador.exe' }] };
  const preliminar = { ...runqa, tag_name: 'v1.8.0', prerelease: true, assets: [{ name: 'RunQA-Installer-1.8.0.exe', browser_download_url: 'https://ejemplo/preliminar.exe' }] };
  const info = await latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon([borrador, preliminar, runqa]) });
  assert.equal(info.version, '1.6.0');
});

test('sin instalador entre los archivos avisa que el release está incompleto', async () => {
  const sinExe = { ...runqa, assets: [runqa.assets[0]] };
  await assert.rejects(
    () => latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon([sinExe]) }),
    (err) => err.code === 'RELEASE_NOT_FOUND',
  );
});

test('si GitHub no responde con un release lo dice claro', async () => {
  await assert.rejects(
    () => latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon([], false) }),
    (err) => err.code === 'RELEASE_NOT_FOUND' && err.message.includes('github.com'),
  );
});

test('si el cuerpo de la respuesta está corrupto lo maneja con código estándar', async () => {
  const fetchImpl = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.reject(new Error('cuerpo roto')),
  });
  await assert.rejects(
    () => latestInstaller({ owner: 'x', repo: 'y', fetchImpl }),
    (err) => err.code === 'RELEASE_NOT_FOUND',
  );
});

test('si la respuesta no es una lista no revienta', async () => {
  await assert.rejects(
    () => latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon({ message: 'Not Found' }) }),
    (err) => err.code === 'RELEASE_NOT_FOUND',
  );
});
