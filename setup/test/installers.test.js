const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInstallers, runFile } = require('../main/installers');

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
    // Por defecto, el mundo en el que el setup instaló Node él mismo y los
    // binarios están donde los dejó.
    exists: () => true,
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
  assert.ok(llamadas[0].cmd.endsWith('msiexec.exe'));
  assert.deepEqual(llamadas[0].args.slice(0, 2), ['/i', 'C:\\Temp\\node-x64.msi']);
  assert.ok(llamadas[0].args.includes('/qn'));
});

test('Node deja el registro verboso del MSI junto al instalador', async () => {
  const { installers, llamadas } = harness();
  await installers.node({ onProgress: () => {} });
  // Con "+" para que el reintento no pise el registro del primer intento.
  const i = llamadas[0].args.indexOf('/l*v+');
  assert.ok(i >= 0, 'falta /l*v+: sin el registro de msiexec no hay nada que diagnosticar');
  assert.equal(llamadas[0].args[i + 1], 'C:\\Temp\\node-msi.log');
});

test('si msiexec falla, el error dice dónde quedó el registro del MSI', async () => {
  const { installers } = harness({ run: () => Promise.reject(new Error('Command failed (código 1618)')) });
  await assert.rejects(
    () => installers.node({ onProgress: () => {} }),
    (err) => {
      assert.match(err.message, /1618/);
      assert.match(err.message, /C:\\Temp\\node-msi\.log/);
      return true;
    },
  );
});

// msiexec no usa 0 como único "salió bien": 3010 y 1641 significan instalado
// correctamente, sólo que Windows quiere reiniciar. Tratarlos como fallo haría
// que el setup se plante habiendo instalado Node bien.
for (const codigo of [3010, 1641]) {
  test(`Node da por buena la instalación si msiexec sale con ${codigo} (pide reinicio)`, async () => {
    const { installers } = harness({
      run: () => Promise.reject(Object.assign(new Error(`Command failed (código ${codigo})`), { exitCode: codigo })),
    });
    await installers.node({ onProgress: () => {} });
  });
}

test('Node sigue fallando con un código que sí es error', async () => {
  const { installers } = harness({
    run: () => Promise.reject(Object.assign(new Error('Command failed (código 1618)'), { exitCode: 1618 })),
  });
  await assert.rejects(() => installers.node({ onProgress: () => {} }), /1618/);
});

test('runFile propaga el código de salida en el mensaje', async () => {
  await assert.rejects(
    () => runFile(process.execPath, ['-e', 'process.exit(3)']),
    (err) => {
      assert.equal(err.exitCode, 3);
      assert.match(err.message, /código 3/);
      return true;
    },
  );
});

test('los navegadores se instalan con la versión fijada, por ruta absoluta y encomillada', async () => {
  const { installers, llamadas } = harness();
  await installers.browsers({ onProgress: () => {} });
  // Con shell:true, Node arma la línea de comando sin encomillar el
  // ejecutable: si la ruta de npx trae un espacio (como en el fixture,
  // "C:\Program Files\..."), cmd.exe corta ahí y falla. Por eso el
  // ejecutable tiene que llegar ya encomillado.
  assert.ok(llamadas[0].cmd.startsWith('"'));
  assert.ok(llamadas[0].cmd.endsWith('"'));
  assert.ok(llamadas[0].cmd.includes('npx.cmd'));
  assert.deepEqual(llamadas[0].args, ['--yes', 'playwright@1.58.2', 'install']);
  assert.equal(llamadas[0].opts.shell, true);
});

/**
 * Si el equipo ya traía Node puesto por otra vía, el setup se salta ese paso y
 * npx NO está en %ProgramFiles%\nodejs. Apuntarle igual a esa ruta absoluta
 * hacía fallar el paso de navegadores con ENOENT en una máquina que tenía todo
 * lo necesario. El PATH sirve justo en ese caso: lo armó quien instaló Node,
 * antes de que el setup arrancara.
 */
test('si Node ya estaba y no vive en Archivos de programa, npx sale del PATH', async () => {
  const { installers, llamadas } = harness({ exists: () => false });
  await installers.browsers({ onProgress: () => {} });
  assert.equal(llamadas[0].cmd, 'npx.cmd');
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
