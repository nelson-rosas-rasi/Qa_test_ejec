const fs = require('node:fs');
const path = require('node:path');

/** Sufijo de perfil, p. ej. `.env.ana`. `.env.example` queda excluido a propósito. */
const MATERIALIZED = /^\.env\.(?!example$).+/;

/** Escribe el `.env.<id>` en claro en la raíz del clon, para que Playwright lo lea. */
function writeEnv({ repoPath, id, values }) {
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(path.join(repoPath, `.env.${id}`), body, 'utf8');
}

/**
 * Borra los `.env.*` materializados de la raíz del clon, menos `.env.example`
 * (commiteado, no es nuestro, y es la fuente del esquema). Es la aserción de
 * seguridad central: un sweep que borre el ejemplo rompe el repo del QA.
 */
function sweep(repoPath) {
  let names;
  try { names = fs.readdirSync(repoPath); }
  catch { return; }
  for (const name of names) {
    if (MATERIALIZED.test(name)) fs.rmSync(path.join(repoPath, name), { force: true });
  }
}

module.exports = { writeEnv, sweep };
