const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, checkRuntime } = require('../main/runtime/check');

test('parseVersion acepta el prefijo v de Node.js', () => {
  assert.deepEqual(parseVersion('v22.18.0\n'), { raw: '22.18.0', major: 22 });
});

test('checkRuntime informa cuando Node.js no existe', async () => {
  const run = async () => { const err = new Error('not found'); err.code = 'ENOENT'; throw err; };
  const result = await checkRuntime({ run, platform: 'linux' });
  assert.equal(result.ok, false);
  assert.equal(result.node.available, false);
  assert.match(result.message, /no está instalado/i);
});

test('checkRuntime rechaza una versión antigua', async () => {
  const run = async (command) => ({ stdout: command === 'node' ? 'v16.20.2\n' : '8.19.4\n' });
  const result = await checkRuntime({ run, platform: 'linux' });
  assert.equal(result.ok, false);
  assert.match(result.message, /18 o superior/);
});

test('checkRuntime acepta Node compatible y npm disponible', async () => {
  const run = async (command) => ({ stdout: command === 'node' ? 'v22.18.0\n' : '10.9.3\n' });
  const result = await checkRuntime({ run, platform: 'linux' });
  assert.equal(result.ok, true);
  assert.equal(result.node.version, '22.18.0');
  assert.equal(result.npm.version, '10.9.3');
});
