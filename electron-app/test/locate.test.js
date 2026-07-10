const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { locatePlaywrightCli } = require('../main/playwright/locate');

const SAMPLE_REPO = path.join(__dirname, '..', 'test-fixtures', 'sample-repo');

test('encuentra el cli.js del repo de juguete', () => {
  const cli = locatePlaywrightCli(SAMPLE_REPO);
  assert.ok(fs.existsSync(cli));
  assert.ok(cli.endsWith(path.join('playwright', 'cli.js')));
});

test('un repo sin Playwright lanza PLAYWRIGHT_NOT_INSTALLED', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-locate-'));
  assert.throws(() => locatePlaywrightCli(dir), (err) => err.code === 'PLAYWRIGHT_NOT_INSTALLED');
});
