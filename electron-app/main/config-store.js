const fs = require('node:fs');
const path = require('node:path');

/**
 * Recibe la carpeta de configuración como argumento (no importa `electron`),
 * para poder probarlo contra un directorio temporal.
 */
function createConfigStore(dir) {
  const file = path.join(dir, 'config.json');

  function readAll() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data && typeof data === 'object' ? data : { projects: {} };
    } catch {
      return { projects: {} };
    }
  }

  return {
    getProject(projectId) {
      const data = readAll();
      return (data.projects && data.projects[projectId]) || {};
    },

    setProject(projectId, patch) {
      const data = readAll();
      if (!data.projects) data.projects = {};
      data.projects[projectId] = { ...data.projects[projectId], ...patch };
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
      return data.projects[projectId];
    },
  };
}

module.exports = { createConfigStore };
