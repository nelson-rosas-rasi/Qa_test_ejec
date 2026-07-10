const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { listTests } = require('../main/playwright/list-tests');
const { locatePlaywrightCli } = require('../main/playwright/locate');

const SAMPLE_REPO = path.join(__dirname, '..', 'test-fixtures', 'sample-repo');

test('lista las pruebas del repo de juguete', { timeout: 90_000 }, async () => {
  const tree = await listTests({ repoPath: SAMPLE_REPO, cliPath: locatePlaywrightCli(SAMPLE_REPO) });

  assert.deepEqual(tree.map((s) => s.id), ['alpha', 'General']);

  const alpha = tree.find((s) => s.id === 'alpha');
  assert.deepEqual(alpha.files.map((f) => f.name), ['mixed.spec.ts', 'ok.spec.ts']);

  const mixed = alpha.files.find((f) => f.name === 'mixed.spec.ts');
  assert.equal(mixed.tests.length, 3);
  assert.ok(mixed.tests.every((t) => /^alpha\/mixed\.spec\.ts:\d+$/.test(t.id)));
  assert.ok(mixed.tests.every((t) => t.name.startsWith('operaciones > ')));
});

test('un repo inexistente lanza LIST_FAILED', { timeout: 90_000 }, async () => {
  await assert.rejects(
    () => listTests({ repoPath: path.join(SAMPLE_REPO, 'no-existe'), cliPath: locatePlaywrightCli(SAMPLE_REPO) }),
    (err) => err.code === 'LIST_FAILED',
  );
});
