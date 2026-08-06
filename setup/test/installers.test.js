const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInstallers } = require('../main/installers');

const ENV = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local', TEMP: 'C:\\Temp' };
const PRE = {
  git: { version: '2.51.0', url: 'https://ejemplo/Git-64-bit.exe', sha256: 'a'.repeat(64) },
  node: { version: '22.21.0', url: 'https://ejemplo/node-x64.msi', sha256: 'b'.repeat(64) },
  playwright: { version: '1.58.2' },
};

function harness(extra = {}) {
  const llamadas = [];
  const installers = buildInstallers({
    run: (cmd, args, opts) => { llamadas.push({ cmd, args, opts }); return Promise.resolve({ stdout: '' }); },
    download: ({ url, dest }) => Promise.resolve(dest || `C:\\Temp\\${url.split('/').pop()}`),
    env: ENV,
    prerequisites: PRE,
    writeMarker: () => {},
    latest: () => Promise.resolve({ name: 'RunQA-Installer-1.6.0.exe', url: 'https://ejemplo/RunQA-Installer-1.6.0.exe', version: '1.6.0' }),
    ...extra,
  });
  return { installers, llamadas };
}

test('git se instala en silencio y sin reiniciar', async () => {
  const { installers, llamadas } = harness();
  await installers.git({ onProgress: () => {} });
  assert.deepEqual(llamadas[0].args, ['/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-']);
});

test('Node se instala con el instalador de Windows en modo silencioso', async () => {
  const { installers, llamadas } = harness();
  await installers.node({ onProgress: () => {} });
  assert.equal(llamadas[0].cmd, 'msiexec');
  assert.deepEqual(llamadas[0].args.slice(0, 2), ['/i', 'C:\\Temp\\node-x64.msi']);
  assert.ok(llamadas[0].args.includes('/qn'));
});

test('los navegadores se instalan con la versión fijada y por ruta absoluta', async () => {
  const { installers, llamadas } = harness();
  await installers.browsers({ onProgress: () => {} });
  assert.ok(llamadas[0].cmd.endsWith('npx.cmd'));
  assert.deepEqual(llamadas[0].args, ['--yes', 'playwright@1.58.2', 'install']);
  assert.equal(llamadas[0].opts.shell, true);
});

test('al terminar los navegadores deja el marcador de versión', async () => {
  let marcador = null;
  const { installers } = harness({ writeMarker: (datos) => { marcador = datos; } });
  await installers.browsers({ onProgress: () => {} });
  assert.deepEqual(marcador, { playwrightVersion: '1.58.2' });
});

test('RunQA se descarga del último release y se ejecuta', async () => {
  const { installers, llamadas } = harness();
  await installers.runqa({ onProgress: () => {} });
  assert.ok(llamadas[0].cmd.endsWith('RunQA-Installer-1.6.0.exe'));
  assert.deepEqual(llamadas[0].args, []);
});
