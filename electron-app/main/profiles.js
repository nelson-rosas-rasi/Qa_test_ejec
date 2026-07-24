const fs = require('node:fs');
const path = require('node:path');
const { appError } = require('./errors');
const { parseEnvExample } = require('./profiles/schema');

const PROFILE_FILE = /^\.env\.(?!example$)(.+)$/;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * Lee el `.env.example` del clon y lo devuelve como esquema del formulario de
 * perfil. Es la plantilla que el repo declara; la app no codifica sus claves.
 */
function readSchema(repoPath) {
  let text;
  try {
    text = fs.readFileSync(path.join(repoPath, '.env.example'), 'utf8');
  } catch {
    throw appError('PROFILE_TEMPLATE_MISSING', 'Este proyecto no trae la plantilla de configuración. Avisa al responsable.');
  }
  return parseEnvExample(text);
}

/**
 * Recupera los perfiles que ya existen en un repositorio local elegido por el
 * usuario. Sólo lee archivos de la raíz; el llamador se encarga de cifrarlos en
 * el almacén de RunQA. El clon original no se modifica.
 */
function readExistingProfiles(repoPath) {
  let names;
  try { names = fs.readdirSync(repoPath); }
  catch { return []; }

  return names
    .map((name) => ({ name, match: name.match(PROFILE_FILE) }))
    .filter(({ match }) => match)
    .map(({ name, match }) => {
      const values = {};
      const text = fs.readFileSync(path.join(repoPath, name), 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const assignment = line.match(ASSIGNMENT);
        if (assignment) values[assignment[1]] = assignment[2];
      }
      return { id: match[1], values };
    })
    .filter(({ values }) => Object.keys(values).length > 0)
    .sort((a, b) => a.id.localeCompare(b.id, 'es'));
}

module.exports = { readSchema, readExistingProfiles };
