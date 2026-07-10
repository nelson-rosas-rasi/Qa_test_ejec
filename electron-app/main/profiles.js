const fs = require('node:fs');
const path = require('node:path');
const { appError } = require('./errors');

/** Las únicas claves que este módulo tiene permitido leer de un .env. */
const VISIBLE_KEYS = ['QA_NOMBRE', 'QA_CARGO'];

function readVisibleKeys(filePath) {
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!VISIBLE_KEYS.includes(key)) continue;
    values[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

function listProfiles(repoPath) {
  const files = fs
    .readdirSync(repoPath)
    .filter((f) => f.startsWith('.env.') && !f.endsWith('.example'));

  if (files.length === 0) {
    throw appError(
      'NO_PROFILE',
      'Este proyecto no tiene perfiles de QA configurados. Falta un archivo .env con tu usuario.',
    );
  }

  return files
    .map((f) => {
      const id = f.slice('.env.'.length);
      const values = readVisibleKeys(path.join(repoPath, f));
      return { id, name: values.QA_NOMBRE || id, role: values.QA_CARGO || 'QA' };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

module.exports = { listProfiles, readVisibleKeys };
