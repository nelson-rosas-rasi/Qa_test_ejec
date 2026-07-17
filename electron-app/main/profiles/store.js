const fs = require('node:fs');
const path = require('node:path');
const { appError } = require('../errors');

/**
 * Copia maestra del perfil, un archivo por perfil bajo `dir/<proyecto>/<id>.enc`,
 * cifrado con safeStorage (DPAPI en Windows). Vive fuera del clon, así que
 * sobrevive a reclonados. Guarda el objeto de valores del formulario tal cual;
 * el nombre y el cargo se leen de las claves QA_NOMBRE/QA_CARGO para el sidebar.
 */
function createProfileStore({ dir, safeStorage }) {
  const projectDir = (projectId) => path.join(dir, projectId);
  const file = (projectId, id) => path.join(projectDir(projectId), `${id}.enc`);

  function readValues(projectId, id) {
    try {
      const encoded = fs.readFileSync(file(projectId, id), 'utf8');
      const buffer = Buffer.from(encoded, 'base64');
      return JSON.parse(safeStorage.decryptString(buffer));
    } catch {
      return null; // no existe, o cifrado por otra cuenta de Windows
    }
  }

  return {
    save(projectId, id, values) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw appError('SECURE_STORAGE_UNAVAILABLE', 'Este equipo no puede guardar tu perfil de forma segura.');
      }
      fs.mkdirSync(projectDir(projectId), { recursive: true });
      const encrypted = safeStorage.encryptString(JSON.stringify(values));
      fs.writeFileSync(file(projectId, id), encrypted.toString('base64'));
    },

    load(projectId, id) {
      return readValues(projectId, id);
    },

    list(projectId) {
      let names;
      try { names = fs.readdirSync(projectDir(projectId)); }
      catch { return []; }
      return names
        .filter((n) => n.endsWith('.enc'))
        .map((n) => {
          const id = n.slice(0, -'.enc'.length);
          const values = readValues(projectId, id);
          return values ? { id, name: values.QA_NOMBRE || id, role: values.QA_CARGO || 'QA' } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },

    remove(projectId, id) {
      fs.rmSync(file(projectId, id), { force: true });
    },
  };
}

module.exports = { createProfileStore };
