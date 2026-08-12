const fs = require('node:fs');
const path = require('node:path');

/**
 * Cuando el instalador abre RunQA con "Ejecutar al terminar", el proceso hereda
 * el PATH viejo: git y Node recién instalados todavía no figuran ahí. Por eso
 * probamos primero las rutas donde los deja RunQA Setup.
 */
const CONOCIDAS = {
  git: ['Git', 'cmd', 'git.exe'],
  'npm.cmd': ['nodejs', 'npm.cmd'],
  npm: ['nodejs', 'npm.cmd'],
};

function resolveCommand(nombre, { exists = fs.existsSync, env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return nombre;
  const partes = CONOCIDAS[nombre];
  if (!partes) return nombre;
  const ruta = path.join(env.ProgramFiles || 'C:\\Program Files', ...partes);
  return exists(ruta) ? ruta : nombre;
}

module.exports = { resolveCommand };
