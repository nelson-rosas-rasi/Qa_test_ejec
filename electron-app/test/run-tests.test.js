const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runTests, buildArgs } = require('../main/playwright/run-tests');
const { locatePlaywrightCli } = require('../main/playwright/locate');

const SAMPLE_REPO = path.join(__dirname, '..', 'test-fixtures', 'sample-repo');
const REPORTER = path.join(__dirname, '..', 'main', 'playwright', 'ndjson-reporter.cjs');

test('buildArgs omite el filtro cuando se corre todo', () => {
  const args = buildArgs({ cliPath: 'cli.js', testIds: ['a:1'], runAll: true, reporters: ['r.cjs'] });
  assert.deepEqual(args, ['cli.js', 'test', '--reporter=r.cjs']);
});

test('buildArgs pasa los ids como filtro', () => {
  const args = buildArgs({ cliPath: 'cli.js', testIds: ['a:1', 'b:2'], runAll: false, reporters: ['r.cjs'] });
  assert.deepEqual(args, ['cli.js', 'test', 'a:1', 'b:2', '--reporter=r.cjs']);
});

test('buildArgs traduce las opciones de ejecución', () => {
  const args = buildArgs({ cliPath: 'cli.js', testIds: [], runAll: true, reporters: ['r.cjs'], visualMode: true, stopOnFail: true });
  assert.ok(args.includes('--headed'));
  assert.ok(args.includes('--max-failures=1'));
});

test('buildArgs une varios reporters con coma', () => {
  const args = buildArgs({ cliPath: 'cli.js', testIds: [], runAll: true, reporters: ['./json-reporter.cjs', '/abs/ndjson.cjs'] });
  assert.ok(args.includes('--reporter=./json-reporter.cjs,/abs/ndjson.cjs'));
});

test('ejecuta el repo de juguete y reporta resultados en vivo', { timeout: 120_000 }, async () => {
  const events = [];
  const { promise } = runTests(
    {
      repoPath: SAMPLE_REPO,
      cliPath: locatePlaywrightCli(SAMPLE_REPO),
      reporters: [REPORTER],
      testIds: ['alpha'],
      runAll: false,
    },
    (event) => events.push(event),
  );

  const { summary } = await promise;

  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped, 1);
  assert.ok(summary.durationMs > 0);

  const results = events.filter((e) => e.channel === 'run:testResult');
  assert.ok(results.some((e) => e.payload.status === 'running'), 'debe anunciar que arranca');
  assert.ok(results.some((e) => e.payload.status === 'failed'), 'debe reportar el fallo');

  const failLog = events.find((e) => e.channel === 'run:log' && e.payload.level === 'fail');
  assert.ok(failLog.payload.text.includes('falla a propósito'));

  const ids = results.map((e) => e.payload.id);
  assert.ok(ids.every((id) => /^alpha\/\w[\w.-]*\.spec\.ts:\d+$/.test(id)), `ids inesperados: ${ids}`);
});

test('stop() corta una corrida larga', { timeout: 120_000 }, async () => {
  const started = Date.now();
  const handle = runTests(
    {
      repoPath: SAMPLE_REPO,
      cliPath: locatePlaywrightCli(SAMPLE_REPO),
      reporters: [REPORTER],
      testIds: ['slow.spec.ts'],
      runAll: false,
    },
    () => {},
  );

  setTimeout(() => handle.stop(), 3000);
  const outcome = await handle.promise;

  assert.equal(outcome.stopped, true);
  assert.ok(Date.now() - started < 45_000, 'no debe esperar los 60s de la prueba');
});
