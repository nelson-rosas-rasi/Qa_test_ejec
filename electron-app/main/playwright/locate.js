const fs = require('node:fs');
const path = require('node:path');
const { appError } = require('../errors');

/**
 * Usa el Playwright *del repo*, nunca uno global: es la única forma de correr la
 * misma versión con la que el equipo escribió las pruebas.
 */
function locatePlaywrightCli(repoPath) {
  const cli = path.join(repoPath, 'node_modules', 'playwright', 'cli.js');
  if (!fs.existsSync(cli)) {
    throw appError(
      'PLAYWRIGHT_NOT_INSTALLED',
      'Este proyecto no tiene sus dependencias instaladas. Pídele a alguien del equipo que las instale.',
    );
  }
  return cli;
}

module.exports = { locatePlaywrightCli };
