const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * RunQA Setup instala los navegadores con una versión fijada y deja un marcador.
 * Un proyecto que use otra versión de Playwright necesita otros binarios, y sin
 * esta comprobación el fallo aparece recién al correr, como "Executable doesn't
 * exist at ...". Preferimos decirlo antes y en castellano.
 *
 * El marcador dice qué versión se instaló, pero sólo existe si el equipo se
 * preparó con el Setup. La caché de navegadores, en cambio, existe siempre que
 * los navegadores estén: es la que decide si FALTAN, y el marcador decide si
 * están DESALINEADOS. Confundir las dos preguntas bloquea equipos que andaban.
 */
/**
 * Playwright deja su caché en un sitio distinto por plataforma. Mirar sólo
 * %LOCALAPPDATA% funcionaba en Windows —el equipo del QA— pero en Linux esa
 * variable no existe: `path.join('', 'ms-playwright')` queda relativo, no se
 * puede leer, y la app anunciaba "faltan navegadores" con la caché llena.
 * `PLAYWRIGHT_BROWSERS_PATH` manda cuando apunta a una carpeta, igual que para
 * Playwright; el valor especial `0` (navegadores dentro de node_modules) no
 * nombra ninguna, así que ahí seguimos con la ruta por defecto.
 */
const defaultBrowsersDir = (env, platform, home) => {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || '', 'ms-playwright');
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
  return path.join(home, '.cache', 'ms-playwright');
};

const browsersDir = (env = process.env, platform = process.platform, home = os.homedir()) => {
  const configurada = env.PLAYWRIGHT_BROWSERS_PATH;
  return configurada && configurada !== '0' ? configurada : defaultBrowsersDir(env, platform, home);
};

const markerPath = (env = process.env) => path.join(browsersDir(env), '.runqa-setup.json');

/** Playwright nombra sus carpetas `chromium-1208`, `firefox-1489`, `webkit-2140`.
 *  Al lado deja archivos sueltos (`.links`, locks) que no son navegadores. */
const CARPETA_DE_NAVEGADOR = /^(chromium|chromium_headless_shell|firefox|webkit)-/i;

const leerJson = (ruta) => {
  try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); }
  catch { return null; }
};

const leerCache = (env = process.env) => {
  try { return fs.readdirSync(browsersDir(env)); }
  catch { return []; }
};

function checkBrowsers({
  repoPath,
  readPackage = () => leerJson(path.join(repoPath, 'node_modules', 'playwright-core', 'package.json')),
  readMarker = () => leerJson(markerPath()),
  readDir = () => leerCache(),
}) {
  const expected = readPackage()?.version || null;
  const installed = readMarker()?.playwrightVersion || null;

  // Sin poder leer lo que pide el proyecto no tenemos con qué comparar: no bloqueamos.
  if (!expected) return { ok: true, expected: null, installed };

  if (installed) {
    return expected === installed
      ? { ok: true, expected, installed }
      : { ok: false, reason: 'mismatch', expected, installed };
  }

  // Sin marcador no sabemos la versión, así que la única pregunta que podemos
  // responder es si hay navegadores. Si los hay, no sabemos ≠ falta: dejamos
  // pasar y que Playwright hable si algo no sirve.
  let presentes = [];
  try { presentes = readDir().filter((entrada) => CARPETA_DE_NAVEGADOR.test(entrada)); }
  catch { presentes = []; }

  return presentes.length
    ? { ok: true, expected, installed: null }
    : { ok: false, reason: 'missing', expected, installed: null };
}

module.exports = { checkBrowsers, markerPath, browsersDir };
