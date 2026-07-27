const fs = require('node:fs');
const path = require('node:path');

/**
 * Cola durable de corridas pendientes de enviar al backend: un JSON por corrida
 * bajo `dir/<runId>.json`. Sin dependencias de Electron (testeable con dir temporal).
 * El envío nunca debe perder una corrida por estar el servidor caído; el tope
 * `maxItems` evita que la cola crezca sin límite si lleva mucho tiempo sin drenar.
 */
function createOutbox({ dir, maxItems = 500 }) {
  const file = (runId) => path.join(dir, `${runId}.json`);

  function readAll() {
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => String(a.enqueuedAt).localeCompare(String(b.enqueuedAt)));
  }

  function write(record) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file(record.runId), JSON.stringify(record, null, 2), 'utf8');
  }

  return {
    enqueue(record) {
      write({ ...record, enqueuedAt: record.enqueuedAt || new Date().toISOString() });
      const items = readAll();
      let discarded = 0;
      for (let i = 0; i < items.length - maxItems; i++) {
        fs.rmSync(file(items[i].runId), { force: true });
        discarded++;
      }
      return discarded;
    },
    list() { return readAll(); },
    remove(runId) { fs.rmSync(file(runId), { force: true }); },
    setDiscarded(runId, value) {
      let record;
      try { record = JSON.parse(fs.readFileSync(file(runId), 'utf8')); } catch { return; }
      record.discardedByQa = value;
      write(record);
    },
  };
}

module.exports = { createOutbox };
