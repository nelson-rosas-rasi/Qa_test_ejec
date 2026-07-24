const fs = require('node:fs');
const path = require('node:path');

/** 1 test → individual; varios o "todos" → conjunto. */
function deriveMode(testIds, runAll) {
  if (runAll) return 'conjunto';
  return Array.isArray(testIds) && testIds.length === 1 ? 'individual' : 'conjunto';
}

/**
 * Un archivo JSON por corrida bajo `dir/<proyecto>/<runId>.json`, y la copia del
 * reporte HTML en `dir/<proyecto>/<runId>/report/`. Sin dependencias de Electron.
 */
function createResultsStore({ dir }) {
  const projectDir = (projectId) => path.join(dir, projectId);
  const recordFile = (projectId, runId) => path.join(projectDir(projectId), `${runId}.json`);
  const runDir = (projectId, runId) => path.join(projectDir(projectId), runId);
  const reportDir = (projectId, runId) => path.join(runDir(projectId, runId), 'report');
  const reportIndex = (projectId, runId) => path.join(reportDir(projectId, runId), 'index.html');
  const reportHtml = (projectId, runId) => path.join(runDir(projectId, runId), 'reporte.html');
  const reportPdf = (projectId, runId, name = 'reporte.pdf') => path.join(runDir(projectId, runId), name);

  return {
    save(record) {
      fs.mkdirSync(projectDir(record.projectId), { recursive: true });
      fs.writeFileSync(recordFile(record.projectId, record.id), JSON.stringify(record, null, 2), 'utf8');
      return record;
    },
    list(projectId) {
      let names;
      try { names = fs.readdirSync(projectDir(projectId)); }
      catch { return []; }
      return names
        .filter((n) => n.endsWith('.json'))
        .map((n) => {
          try { return JSON.parse(fs.readFileSync(path.join(projectDir(projectId), n), 'utf8')); }
          catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    },
    get(projectId, runId) {
      try { return JSON.parse(fs.readFileSync(recordFile(projectId, runId), 'utf8')); }
      catch { return null; }
    },
    remove(projectId, runId) {
      fs.rmSync(recordFile(projectId, runId), { force: true });
      fs.rmSync(runDir(projectId, runId), { recursive: true, force: true });
    },
    runDir, reportDir, reportIndex, reportHtml, reportPdf,
  };
}

module.exports = { createResultsStore, deriveMode };
