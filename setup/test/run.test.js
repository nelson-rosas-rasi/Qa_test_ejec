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

test('un paso saltado no se ejecuta y deja seguir con el resto', async () => {
  // Los navegadores pueden tardar muchísimo o quedarse trabados: el QA tiene que
  // poder llegar igual a instalar RunQA en vez de quedarse encerrado ahí.
  const { runner, ejecutados, publicados } = harness();
  await runner.refresh();
  runner.skip('browsers');
  await runner.start();
  assert.deepEqual(ejecutados, ['git', 'node', 'runqa']);
  assert.equal(publicados.at(-1).steps.find((s) => s.id === 'browsers').status, 'skipped');
});

test('saltar RunQA no está permitido: es el sentido del setup', async () => {
  const { runner, ejecutados } = harness();
  await runner.refresh();
  runner.skip('runqa');
  await runner.start();
  assert.ok(ejecutados.includes('runqa'));
});

test('la salida del instalador se publica mientras corre, no al final', async () => {
  const publicados = [];
  const runner = createRunner({
    detect: () => Promise.resolve(estadoCompleto),
    installers: {
      git: ({ onOutput }) => { onOutput('Descargando 12%'); onOutput('Descargando 87%'); return Promise.resolve(); },
      node: () => Promise.resolve(), browsers: () => Promise.resolve(), runqa: () => Promise.resolve(),
    },
    publish: (estado) => publicados.push({ ...estado, salida: [...(estado.salida || [])] }),
  });
  await runner.refresh();
  await runner.retry('git');
  const conSalida = publicados.filter((p) => (p.salida || []).length > 0);
  assert.ok(conSalida.length >= 2, 'cada línea tiene que publicarse cuando llega');
  assert.deepEqual(conSalida.at(-1).salida.slice(-2), ['Descargando 12%', 'Descargando 87%']);
});

test('saltar el paso que está corriendo lo corta y sigue con el siguiente', async () => {
  // El caso real: `playwright install` bajando cientos de megas, sin avanzar.
  // Marcarlo como salteado no alcanza — hay que cortar el proceso, o start()
  // se queda esperando para siempre.
  const ejecutados = [];
  const publicados = [];
  let cortado = false;
  // La primera lectura es la del plan (nada instalado); las siguientes son las
  // verificaciones posteriores a cada instalación, que tienen que confirmar.
  let vuelta = 0;
  const runner = createRunner({
    detect: () => Promise.resolve(vuelta++ === 0 ? estadoLimpio : estadoCompleto),
    installers: {
      git: () => { ejecutados.push('git'); return Promise.resolve(); },
      node: () => { ejecutados.push('node'); return Promise.resolve(); },
      browsers: ({ signal }) => new Promise((_resolve, reject) => {
        ejecutados.push('browsers');
        signal.addEventListener('abort', () => { cortado = true; reject(new Error('cancelado')); });
      }),
      runqa: () => { ejecutados.push('runqa'); return Promise.resolve(); },
    },
    publish: (estado) => {
      publicados.push(estado);
      // Apenas los navegadores empiezan a correr, el QA toca «Saltar».
      if (estado.steps.find((s) => s.id === 'browsers')?.status === 'running') {
        setImmediate(() => runner.skip('browsers'));
      }
    },
  });
  await runner.refresh();
  await runner.start();
  assert.equal(cortado, true, 'el proceso tiene que cancelarse');
  assert.ok(ejecutados.includes('runqa'), 'después de saltar tiene que seguir con RunQA');
  assert.equal(publicados.at(-1).steps.find((s) => s.id === 'browsers').status, 'skipped');
});
