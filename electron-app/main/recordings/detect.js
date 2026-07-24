function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/** Primera URL http(s) del `.env`, prefiriendo claves con URL/BASE/HOST/SERVER. */
function detectBaseUrl(values) {
  if (!values || typeof values !== 'object') return '';
  const entries = Object.entries(values).map(([k, v]) => [k, String(v ?? '').trim()]);
  const isUrl = (v) => /^https?:\/\//i.test(v);
  const preferred = entries.find(([k, v]) => isUrl(v) && /url|base|host|server/i.test(k));
  if (preferred) return preferred[1];
  const any = entries.find(([, v]) => isUrl(v));
  return any ? any[1] : '';
}

/** Nombre de archivo del draft: `<slug>.spec.ts`. */
function draftFileName(name) {
  return (slugify(name) || 'grabacion') + '.spec.ts';
}

/** Carpeta segura y estable para los drafts versionados de un perfil. */
function profileDraftFolder(profileId) {
  return String(profileId || '')
    .replace(/^\.env\./i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80) || 'sin-perfil';
}

/** Ruta POSIX que se incluirá en Git, independiente del sistema operativo. */
function recordingRepoPath(profileId, name) {
  return `drafts/${profileDraftFolder(profileId)}/${draftFileName(name)}`;
}

/**
 * Normaliza un nombre de rama de git; '' si queda inválido.
 * Quita también guiones iniciales: un valor como "--force" o
 * "--receive-pack=…" sin el guion inicial deja de leerse como una opción de
 * git en `git push origin <branch>` (git admite opciones después de los
 * posicionales).
 */
function sanitizeBranch(name) {
  const s = String(name || '').trim()
    .replace(/\s+/g, '-')
    .replace(/[~^:?*[\\]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^[/.]+|[/.]+$/g, '')
    .replace(/^-+/, '');
  return s;
}

module.exports = { detectBaseUrl, draftFileName, profileDraftFolder, recordingRepoPath, sanitizeBranch, slugify };
