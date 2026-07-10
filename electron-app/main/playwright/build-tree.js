const { appError } = require('../errors');

/**
 * El JSON de `--list` anida: suite de archivo → suites de `describe` → specs.
 * `spec.file` viene relativo a rootDir y siempre con `/`, incluso en Windows.
 */
function collectSpecs(suite, ancestors, out) {
  for (const spec of suite.specs || []) {
    out.push({ file: spec.file, line: spec.line, name: [...ancestors, spec.title].join(' > ') });
  }
  for (const child of suite.suites || []) {
    collectSpecs(child, [...ancestors, child.title], out);
  }
}

function buildTree(listJson) {
  if (Array.isArray(listJson.errors) && listJson.errors.length > 0) {
    const detail = listJson.errors.map((e) => e.message || String(e)).join('\n');
    throw appError('LIST_FAILED', `Playwright no pudo leer las pruebas:\n${detail}`);
  }

  const specs = [];
  for (const fileSuite of listJson.suites || []) collectSpecs(fileSuite, [], specs);

  const suites = new Map();
  for (const spec of specs) {
    const parts = spec.file.split('/');
    const suiteName = parts.length > 1 ? parts[0] : 'General';
    const fileName = parts[parts.length - 1];

    if (!suites.has(suiteName)) suites.set(suiteName, new Map());
    const files = suites.get(suiteName);
    if (!files.has(spec.file)) files.set(spec.file, { id: spec.file, name: fileName, tests: [] });
    files.get(spec.file).tests.push({ id: `${spec.file}:${spec.line}`, name: spec.name });
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'es');

  return [...suites.entries()]
    .map(([name, files]) => ({ id: name, name, files: [...files.values()].sort(byName) }))
    .sort(byName);
}

module.exports = { buildTree };
