const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { binaryPaths, browsersDir, markerPath } = require('../paths');
const { downloadTo } = require('../download');
const { latestInstaller } = require('../releases');

const OWNER = 'nelson-rosas-rasi';
const REPO = 'Qa_test_ejec';

function runFile(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
      else resolve({ stdout, stderr });
    });
  });
}

const defaultWriteMarker = (env) => (datos) => {
  fs.mkdirSync(browsersDir(env), { recursive: true });
  fs.writeFileSync(markerPath(env), JSON.stringify(datos, null, 2));
};

function buildInstallers({
  run = runFile,
  download = downloadTo,
  env = process.env,
  prerequisites = require('../../prerequisites.json'),
  writeMarker,
  latest = (opts) => latestInstaller({ owner: OWNER, repo: REPO, ...opts }),
} = {}) {
  const paths = binaryPaths(env);
  const temp = env.TEMP || env.TMP || 'C:\\Windows\\Temp';
  const marcar = writeMarker || defaultWriteMarker(env);
  // path.win32 (no path.join a secas): este setup sólo corre en Windows,
  // pero las pruebas se ejecutan en cualquier SO y path.join usaría el
  // separador del host, mezclando barras con las contrabarras literales
  // de env.TEMP.
  const destino = (url) => path.win32.join(temp, url.split('/').pop());

  return {
    async git({ onProgress }) {
      const archivo = await download({ url: prerequisites.git.url, dest: destino(prerequisites.git.url), sha256: prerequisites.git.sha256, onProgress });
      // Instalador Inno Setup: silencioso, sin reinicio y sin botón de cancelar.
      await run(archivo, ['/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-']);
    },

    async node({ onProgress }) {
      const archivo = await download({ url: prerequisites.node.url, dest: destino(prerequisites.node.url), sha256: prerequisites.node.sha256, onProgress });
      await run('msiexec', ['/i', archivo, '/qn', '/norestart']);
    },

    async browsers({ onProgress }) {
      onProgress(0);
      // npx es un .cmd y Node >=20.12 se niega a ejecutarlo sin shell. Los
      // argumentos son constantes (salen de prerequisites.json), así que
      // concatenarlos es seguro.
      await run(paths.npx, ['--yes', `playwright@${prerequisites.playwright.version}`, 'install'], { shell: true });
      marcar({ playwrightVersion: prerequisites.playwright.version });
      onProgress(100);
    },

    async runqa({ onProgress }) {
      const info = await latest({});
      const archivo = await download({ url: info.url, dest: path.win32.join(temp, info.name), sha256: null, onProgress, verify: false });
      await run(archivo, []);
    },
  };
}

module.exports = { buildInstallers, OWNER, REPO };
