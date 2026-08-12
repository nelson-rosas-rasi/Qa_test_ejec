const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { binaryPaths, browsersDir, markerPath } = require('../paths');
const { downloadTo } = require('../download');
const { latestInstaller } = require('../releases');

const OWNER = 'nelson-rosas-rasi';
const REPO = 'Qa_test_ejec';

/** ERROR_SUCCESS_REBOOT_REQUIRED (3010) y ERROR_SUCCESS_REBOOT_INITIATED (1641):
 *  msiexec instaló bien y sólo pide reinicio. */
const MSI_OK_REINICIO = [3010, 1641];

function runFile(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        // El mensaje de execFile es "Command failed: <comando>" y NO incluye el
        // código de salida. Los instaladores de Windows no escriben nada en
        // stderr: el código es todo lo que dejan (1603, 1618, 1619...), así que
        // sin él un fallo es indiagnosticable. `err.code` es numérico cuando el
        // proceso corrió y salió mal, y una cadena (ENOENT) si no arrancó.
        if (typeof err.code === 'number') {
          err.exitCode = err.code;
          err.message = err.message.replace('Command failed:', `Command failed (código ${err.code}):`);
        }
        reject(err);
      } else resolve({ stdout, stderr });
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
  exists = fs.existsSync,
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
      // /l*v: msiexec es la única fuente que explica POR QUÉ falló. Sin esto
      // sólo queda el código de salida, que dice qué pasó pero no dónde.
      // El "+" agrega en vez de sobrescribir: si el QA reintenta, el registro
      // del primer intento tiene que sobrevivir para poder comparar los dos.
      const registro = path.win32.join(temp, 'node-msi.log');
      try {
        await run(paths.msiexec, ['/i', archivo, '/qn', '/norestart', '/l*v+', registro]);
      } catch (err) {
        // Para msiexec el éxito no es sólo 0: 3010 y 1641 quieren decir
        // "instalado, hace falta reiniciar". Darlos por fallo dejaría plantado
        // el setup con Node ya instalado. Igual no confiamos en el código: el
        // runner vuelve a mirar el sistema antes de dar el paso por hecho.
        if (MSI_OK_REINICIO.includes(err.exitCode)) return;
        err.message = `${err.message}\nRegistro del instalador de Windows: ${registro}`;
        throw err;
      }
    },

    async browsers({ onProgress }) {
      onProgress(0);
      // npx es un .cmd y Node >=20.12 se niega a ejecutarlo sin shell. Los
      // argumentos son constantes (salen de prerequisites.json), así que
      // concatenarlos es seguro. Con shell:true, Node arma la línea de
      // comando uniendo [cmd, ...args] con espacios SIN encomillar el
      // ejecutable: si la ruta trae un espacio (p. ej. "C:\Program Files\
      // nodejs\npx.cmd", que es justo donde queda tras instalar Node en el
      // paso anterior), cmd.exe corta ahí y falla. Hay que encomillarlo.
      //
      // La ruta absoluta sólo vale si Node lo instaló este setup: cuando el
      // equipo ya lo traía por winget o Chocolatey, ese paso se salta y npx
      // vive en otro lado. Ahí el nombre pelado alcanza, porque el PATH lo armó
      // quien instaló Node antes de que el setup arrancara. Al revés no
      // funciona: recién instalado, el PATH de este proceso todavía es el viejo.
      const npx = exists(paths.npx) ? `"${paths.npx}"` : 'npx.cmd';
      await run(npx, ['--yes', `playwright@${prerequisites.playwright.version}`, 'install'], { shell: true });
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

module.exports = { buildInstallers, runFile, OWNER, REPO };
