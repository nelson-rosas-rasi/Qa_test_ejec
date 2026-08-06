const path = require('node:path');

/**
 * Tras instalar git o Node, el PATH nuevo no existe en este proceso: Windows
 * sólo lo propaga a procesos creados después. Por eso todo se resuelve por
 * ruta absoluta y nunca por nombre de comando.
 */
const programFiles = (env) => env.ProgramFiles || 'C:\\Program Files';
const localAppData = (env) => env.LOCALAPPDATA || path.join('C:\\Users', 'Default', 'AppData', 'Local');

function binaryPaths(env = process.env) {
  const base = programFiles(env);
  const nodeDir = path.join(base, 'nodejs');
  return {
    git: path.join(base, 'Git', 'cmd', 'git.exe'),
    node: path.join(nodeDir, 'node.exe'),
    npm: path.join(nodeDir, 'npm.cmd'),
    npx: path.join(nodeDir, 'npx.cmd'),
  };
}

function browsersDir(env = process.env) {
  return path.join(localAppData(env), 'ms-playwright');
}

/** Playwright nombra sus carpetas por número de build (chromium-1208), no por
 *  su versión. El setup deja este marcador para saber qué versión dejó. */
function markerPath(env = process.env) {
  return path.join(browsersDir(env), '.runqa-setup.json');
}

module.exports = { binaryPaths, browsersDir, markerPath };
