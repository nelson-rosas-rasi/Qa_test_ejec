const fs = require('node:fs');
const path = require('node:path');
const { appError } = require('./errors');
const { parseEnvExample } = require('./profiles/schema');

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

module.exports = { readSchema };
