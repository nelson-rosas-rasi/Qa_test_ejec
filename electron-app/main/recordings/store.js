const fs = require('node:fs');
const path = require('node:path');

/** Drafts de grabaciones: `<dir>/<projectId>/<id>.spec.ts` + `<id>.json` (meta). */
function createRecordingsStore({ dir }) {
  const projectDir = (projectId) => path.join(dir, projectId);
  const specFile = (projectId, id) => path.join(projectDir(projectId), `${id}.spec.ts`);
  const metaFile = (projectId, id) => path.join(projectDir(projectId), `${id}.json`);

  function readMeta(projectId, id) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile(projectId, id), 'utf8'));
      // Compatibilidad con grabaciones creadas antes de que existiera `status`.
      return { ...meta, status: meta.status || (meta.uploaded ? 'uploaded' : 'draft') };
    } catch { return null; }
  }
  function writeMeta(projectId, id, meta) {
    fs.mkdirSync(projectDir(projectId), { recursive: true });
    fs.writeFileSync(metaFile(projectId, id), JSON.stringify(meta, null, 2), 'utf8');
    return meta;
  }

  return {
    specFile,
    list(projectId) {
      let names;
      try { names = fs.readdirSync(projectDir(projectId)); } catch { return []; }
      return names.filter((n) => n.endsWith('.json'))
        .map((n) => readMeta(projectId, n.slice(0, -'.json'.length)))
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    saveMeta(projectId, id, name, profileId = null, profileName = null) {
      return writeMeta(projectId, id, {
        id,
        name,
        profileId,
        profileName,
        status: 'draft',
        createdAt: new Date().toISOString(),
        uploaded: null,
      });
    },
    rename(projectId, id, name) {
      const meta = readMeta(projectId, id);
      if (!meta) return null;
      meta.name = name;
      return writeMeta(projectId, id, meta);
    },
    markUploaded(projectId, id, branch) {
      const meta = readMeta(projectId, id);
      if (!meta) return null;
      meta.status = 'uploaded';
      meta.uploaded = { branch, at: new Date().toISOString() };
      return writeMeta(projectId, id, meta);
    },
    remove(projectId, id) {
      fs.rmSync(specFile(projectId, id), { force: true });
      fs.rmSync(metaFile(projectId, id), { force: true });
    },
  };
}

module.exports = { createRecordingsStore };
