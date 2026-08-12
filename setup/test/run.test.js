const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunner } = require('../main/run');

const estadoLimpio = { git: { ok: false }, node: { ok: false }, npm: { ok: false }, browsers: { ok: false } };
const estadoCompleto = { git: { ok: true }, node: { ok: true }, npm: { ok: true }, browsers: { ok: true } };

function harness({ falla = null, detectados = [estadoLimpio, estadoCompleto] } = {}) {
  const publicados = [];
  let vuelta = 0;
  const ejecutados = [];
  const runner = createRunner({
    detect: () => Promise.resolve(detectados[Math.min(vuelta++, detectados.length - 1)]),
    installers: {
      git: () => { ejecutados.push('git'); return falla === 'git' ? Promise.reject(new Error('sin permisos')) : Promise.resolve(); },
      node: () => { ejecutados.push('node'); return Promise.resolve(); },
      browsers: () => { ejecutados.push('browsers'); return Promise.resolve(); },
      runqa: () => { ejecutados.push('runqa'); return Promise.resolve(); },
    },
    publish: (estado) => publicados.push(estado),
  });
  return { runner, publicados, ejecutados };
}

test('al refrescar publica el plan sin ejecutar nada', async () => {
  const { runner, publicados, ejecutados } = harness();
  await runner.refresh();
  assert.deepEqual(ejecutados, []);
  assert.deepEqual(publicados.at(-1).steps.map((s) => s.id), ['git', 'node', 'browsers', 'runqa']);
});

test('start ejecuta en orden y termina con RunQA', async () => {
  const { runner, ejecutados } = harness();
  await runner.refresh();
  await runner.start();
  assert.deepEqual(ejecutados, ['git', 'node', 'browsers', 'runqa']);
});

test('un paso que falla detiene la cadena y deja el error visible', async () => {
  const { runner, publicados, ejecutados } = harness({ falla: 'git' });
  await runner.refresh();
  await runner.start();
  assert.deepEqual(ejecutados, ['git']);
  const final = publicados.at(-1);
  assert.equal(final.steps.find((s) => s.id === 'git').status, 'error');
  assert.equal(final.error, 'sin permisos');
});

test('reintentar un paso vuelve a ejecutar sólo ese paso', async () => {
  const { runner, ejecutados } = harness({ falla: 'git' });
  await runner.refresh();
  await runner.start();
  ejecutados.length = 0;
  await runner.retry('git');
  assert.deepEqual(ejecutados, ['git']);
});

test('lo ya instalado no se vuelve a ejecutar', async () => {
  const { runner, ejecutados } = harness({ detectados: [estadoCompleto] });
  await runner.refresh();
  await runner.start();
  assert.deepEqual(ejecutados, ['runqa']);
});

test('si el instalador termina pero el requisito sigue faltando, no sigue de largo', async () => {
  const { runner, publicados, ejecutados } = harness({ detectados: [estadoLimpio] });
  await runner.refresh();
  await runner.start();
  assert.deepEqual(ejecutados, ['git']);
  const paso = publicados.at(-1).steps.find((s) => s.id === 'git');
  assert.equal(paso.status, 'error');
  assert.match(publicados.at(-1).error, /no qued[oó] instalad/i);
});
