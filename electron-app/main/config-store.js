const fs = require('node:fs');
const path = require('node:path');

/**
 * Recibe la carpeta de configuración como argumento (no importa `electron`),
 * para poder probarlo contra un directorio temporal.
 */
function createConfigStore(dir) {
  const file = path.join(dir, 'config.json');

  function readAll() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { projects: {} };
      throw err;
    }

    try {
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : { projects: {} };
    } catch {
      return { projects: {} };
    }
  }

  function writeAll(data) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    listProjects() {
      const data = readAll();
      return Object.entries(data.projects || {}).map(([id, project]) => ({ id, ...project }));
    },

    getProject(projectId) {
      const data = readAll();
      return (data.projects && data.projects[projectId]) || {};
    },

    setProject(projectId, patch) {
      const data = readAll();
      if (!data.projects) data.projects = {};
      data.projects[projectId] = { ...data.projects[projectId], ...patch };
      writeAll(data);
      return data.projects[projectId];
    },

    /** Claves de alcance global (no ligadas a un proyecto), en la raíz del JSON. */
    getSetting(key) {
      if (key === 'projects') throw new Error('La clave "projects" está reservada');
      return readAll()[key];
    },

    setSetting(key, value) {
      if (key === 'projects') throw new Error('La clave "projects" está reservada');
      const data = readAll();
      if (value === null || value === undefined) delete data[key];
      else data[key] = value;
      writeAll(data);
      return data[key];
    },
  };
}

module.exports = { createConfigStore };
