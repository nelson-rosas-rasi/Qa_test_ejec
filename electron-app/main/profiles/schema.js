/**
 * Convierte el `.env.example` del repo en la lista de campos del formulario.
 * El repo ya documenta cada clave ahí, así que la app no codifica ningún nombre
 * de clave de este proyecto: sirve para cualquier repo con un `.env.example`.
 */

// Clave de entorno: empieza por letra/_ y admite dígitos (N8N_WEBHOOK_URL).
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
// Separador decorativo: un comentario con decoración en ambos lados (# ─── ... ───).
const DECORATIVE = /^#\s*[\W_]+.*[\W_]+\s*$/;

function parseEnvExample(text) {
  const fields = [];
  let help = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') { help = []; continue; }           // el blanco corta la ayuda
    if (line.startsWith('#')) {
      if (!DECORATIVE.test(line)) help.push(line.replace(/^#\s?/, '').trim());
      continue;
    }
    const match = line.match(ASSIGNMENT);
    if (!match) { help = []; continue; }
    fields.push({ key: match[1], value: match[2], help: help.join(' ') });
    help = [];
  }
  return fields;
}

module.exports = { parseEnvExample };
