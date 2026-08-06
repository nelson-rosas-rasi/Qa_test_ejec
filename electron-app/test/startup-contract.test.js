const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('el arranque no verifica ni ofrece descargar Node o npm', () => {
  assert.doesNotMatch(read('renderer/renderer.js'), /ensureRuntime|renderRuntimeChecking|renderRuntimeSetup/);
  assert.doesNotMatch(read('preload.js'), /checkRuntime|openNodeDownload/);
  assert.doesNotMatch(read('main/ipc.js'), /runtime:check|runtime:openNodeDownload/);
});
