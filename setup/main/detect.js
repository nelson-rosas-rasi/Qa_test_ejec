const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { binaryPaths, browsersDir, markerPath } = require('./paths');

function runFile(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, ...opts }, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout });
    });
  });
}

const defaultMarker = (env) => {
  try { return JSON.parse(fs.readFileSync(markerPath(env), 'utf8')); }
  catch { return null; }
};

const defaultBrowsersDir = (env) => {
  try { return fs.readdirSync(browsersDir(env)); }
  catch { return []; }
};

/** Playwright nombra sus carpetas `chromium-1208`, `firefox-1489`, `webkit-2140`.
 *  Al lado deja archivos sueltos (`.links`, locks) que no son navegadores. */
const CARPETA_DE_NAVEGADOR = /^(chromium|chromium_headless_shell|firefox|webkit)-/i;

/** "git version 2.51.0.windows.1" y "v22.21.0" -> "2.51.0" */
function parseVersion(output) {
  const match = String(output).match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Compara x.y.z segmento por segmento y como número: comparar el texto daría
 * "10.9.0" < "9.1.0", que es exactamente el error que dejaría reinstalando
 * encima de una versión que ya sirve.
 */
function compareVersions(a, b) {
  const partes = (v) => String(v).split('.').map(Number);
  const [x, y] = [partes(a), partes(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] || 0) - (y[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Node >=20.12 se niega a ejecutar un .cmd sin shell. */
const needsShell = (command) => /\.(cmd|bat)$/i.test(command);

/**
 * Busca el binario en dos lugares y en este orden:
 *
 * 1. La ruta absoluta donde lo deja este mismo setup (`%ProgramFiles%`). Va
 *    primero porque tras instalar Node el PATH del proceso todavía es el viejo
 *    y no lo incluye: si preguntáramos al PATH diríamos que no está.
 * 2. El PATH, con el nombre pelado. Cubre el caso contrario: el equipo ya traía
 *    git o Node puestos por winget, Chocolatey o a mano en otro disco. Ahí el
 *    PATH sí es correcto, porque se armó antes de que el setup arrancara.
 *
 * Encontrarlo no alcanza: si `minVersion` está definida y la versión instalada
 * es menor, se devuelve `ok: false` con `reason: 'outdated'`. Estar presente y
 * servir son dos preguntas distintas, y darlas por la misma dejaba pasar un
 * Node viejo que recién reventaba al correr `npm ci` en un proyecto.
 */
async function probe({ exists, run, ruta, fallback, args, minVersion }) {
  const candidatos = [...(exists(ruta) ? [ruta] : []), ...(fallback ? [fallback] : [])];
  for (const candidato of candidatos) {
    let stdout;
    try {
      ({ stdout } = await run(candidato, args, needsShell(candidato) ? { shell: true } : {}));
    } catch {
      continue;
    }
    const version = parseVersion(stdout);
    if (!version) continue;
    if (minVersion && compareVersions(version, minVersion) < 0) {
      return { ok: false, version, reason: 'outdated', minVersion };
    }
    return { ok: true, version };
  }
  return { ok: false, version: null };
}

async function detectPrerequisites({
  exists = fs.existsSync,
  run = runFile,
  env = process.env,
  platform = process.platform,
  minimums = {},
  playwrightVersion,
  readMarker = () => defaultMarker(env),
  readBrowsersDir = () => defaultBrowsersDir(env),
} = {}) {
  const paths = binaryPaths(env);
  const npmEnPath = platform === 'win32' ? 'npm.cmd' : 'npm';
  const [git, node, npm] = await Promise.all([
    probe({ exists, run, ruta: paths.git, fallback: 'git', args: ['--version'], minVersion: minimums.git }),
    probe({ exists, run, ruta: paths.node, fallback: 'node', args: ['--version'], minVersion: minimums.node }),
    probe({ exists, run, ruta: paths.npm, fallback: npmEnPath, args: ['--version'], minVersion: minimums.npm }),
  ]);
  const marker = readMarker();
  const instalada = marker?.playwrightVersion || null;
  // El marcador dice qué versión dejó el setup; la caché dice qué hay de verdad.
  // Con el marcador solo, una caché borrada a mano pasaba por instalada y el
  // fallo salía recién al correr una prueba, como "Executable doesn't exist".
  const hayNavegadores = readBrowsersDir().some((entrada) => CARPETA_DE_NAVEGADOR.test(entrada));
  const browsers = { ok: instalada === playwrightVersion && hayNavegadores, version: instalada };
  return { git, node, npm, browsers };
}

module.exports = { detectPrerequisites, parseVersion, compareVersions };
