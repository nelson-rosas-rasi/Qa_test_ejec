const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReleaseConfig } = require('../scripts/check-release-config');

test('bloquea la publicación con el repositorio de ejemplo', () => {
  const result = validateReleaseConfig({ build: { publish: { owner: 'CAMBIAME-usuario-u-org', repo: 'runqa-releases' } } });
  assert.deepEqual(result, { ok: false, missing: ['owner', 'repo'] });
});

test('permite publicar cuando owner y repo son reales', () => {
  const result = validateReleaseConfig({ build: { publish: { owner: 'mi-equipo', repo: 'runqa-desktop' } } });
  assert.deepEqual(result, { ok: true, missing: [] });
});
