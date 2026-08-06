const test = require('node:test');
const assert = require('node:assert/strict');
const { latestInstaller } = require('../main/releases');

const release = {
  tag_name: 'v1.6.0',
  assets: [
    { name: 'latest.yml', browser_download_url: 'https://ejemplo/latest.yml' },
    { name: 'runqa-1.6.0-x64.nsis.7z', browser_download_url: 'https://ejemplo/paquete.7z' },
    { name: 'RunQA-Installer-1.6.0.exe', browser_download_url: 'https://ejemplo/RunQA-Installer-1.6.0.exe' },
  ],
};
const fetchCon = (cuerpo, ok = true) => () => Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(cuerpo) });

test('elige el instalador entre todos los archivos del release', async () => {
  const info = await latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon(release) });
  assert.equal(info.name, 'RunQA-Installer-1.6.0.exe');
  assert.equal(info.url, 'https://ejemplo/RunQA-Installer-1.6.0.exe');
  assert.equal(info.version, '1.6.0');
});

test('sin instalador entre los archivos avisa que el release está incompleto', async () => {
  const sinExe = { ...release, assets: [release.assets[0]] };
  await assert.rejects(
    () => latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon(sinExe) }),
    (err) => err.code === 'RELEASE_NOT_FOUND',
  );
});

test('si GitHub no responde con un release lo dice claro', async () => {
  await assert.rejects(
    () => latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon({}, false) }),
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
