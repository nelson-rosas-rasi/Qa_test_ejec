const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { binaryPaths, browsersDir, markerPath } = require('../paths');
const { downloadTo } = require('../download');
const { latestInstaller } = require('../releases');

const OWNER = 'nelson-rosas-rasi';
const REPO = 'Qa_test_ejec';

/** ERROR_SUCCESS_REBOOT_REQUIRED (3010) y ERROR_SUCCESS_REBOOT_INITIATED (1641):
 *  msiexec instaló bien y sólo pide reinicio. */
const MSI_OK_REINICIO = [3010, 1641];

/**
 * `spawn` y no `execFile`: execFile acumula toda la salida y no entrega nada
 * hasta que el proceso termina. `playwright install` baja cientos de megas, así
 * que la pantalla quedaba muda varios minutos y era imposible distinguir un
 * paso lento de uno colgado. Ahora cada línea sale en el momento.
 */
function runFile(command, args, opts = {}) {
  const { onOutput = () => {}, ...resto } = opts;
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let resto_linea = '';

    const emitirLineas = (texto) => {
      const partes = (resto_linea + texto).split(/\r?\n/);
      resto_linea = partes.pop();
      // \r sin \n: las barras de progreso reescriben la misma línea.
      for (const linea of partes) onOutput(linea.split('\r').pop());
    };

    let hijo;
    try {
      hijo = spawn(command, args, { windowsHide: true, ...resto });
    } catch (err) {
      reject(err);
      return;
    }

    hijo.stdout?.on('data', (dato) => { stdout += dato; emitirLineas(String(dato)); });
    hijo.stderr?.on('data', (dato) => { stderr += dato; emitirLineas(String(dato)); });

    hijo.on('error', (err) => reject(err));
    hijo.on('close', (code) => {
      if (resto_linea) onOutput(resto_linea.split('\r').pop());
      if (code === 0) { resolve({ stdout, stderr }); return; }
      // Los instaladores de Windows no escriben nada en stderr: el código de
      // salida es todo lo que dejan (1603, 1618, 1619...), así que tiene que
      // viajar en el mensaje o el fallo queda indiagnosticable.
      const err = new Error(`Command failed (código ${code}): ${command} ${args.join(' ')}`);
      err.exitCode = code;
      err.code = code;
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
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
    async git({ onProgress, onOutput = () => {}, signal }) {
      onOutput('Descargando el instalador de git...');
      const archivo = await download({ url: prerequisites.git.url, dest: destino(prerequisites.git.url), sha256: prerequisites.git.sha256, onProgress });
      onOutput(`Instalando ${archivo}`);
      // Instalador Inno Setup: silencioso, sin reinicio y sin botón de cancelar.
      await run(archivo, ['/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-'], { onOutput, signal });
    },

    async node({ onProgress, onOutput = () => {}, signal }) {
      onOutput('Descargando el instalador de Node...');
      const archivo = await download({ url: prerequisites.node.url, dest: destino(prerequisites.node.url), sha256: prerequisites.node.sha256, onProgress });
      onOutput(`Instalando ${archivo}`);
      // /l*v: msiexec es la única fuente que explica POR QUÉ falló. Sin esto
      // sólo queda el código de salida, que dice qué pasó pero no dónde.
      // El "+" agrega en vez de sobrescribir: si el QA reintenta, el registro
      // del primer intento tiene que sobrevivir para poder comparar los dos.
      const registro = path.win32.join(temp, 'node-msi.log');
      try {
        await run(paths.msiexec, ['/i', archivo, '/qn', '/norestart', '/l*v+', registro], { onOutput, signal });
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

    async browsers({ onProgress, onOutput = () => {}, signal }) {
      onProgress(0);
      onOutput('Descargando los navegadores de prueba. Son varios cientos de megas: puede tardar.');
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
      await run(npx, ['--yes', `playwright@${prerequisites.playwright.version}`, 'install'], { shell: true, onOutput, signal });
      marcar({ playwrightVersion: prerequisites.playwright.version });
      onProgress(100);
    },

    async runqa({ onProgress, onOutput = () => {}, signal }) {
      const info = await latest({});
      onOutput(`Descargando ${info.name}`);
      const archivo = await download({ url: info.url, dest: path.win32.join(temp, info.name), sha256: null, onProgress, verify: false });
      onOutput('Abriendo el instalador de RunQA...');
      await run(archivo, [], { onOutput, signal });
    },
  };
}

module.exports = { buildInstallers, runFile, OWNER, REPO };
