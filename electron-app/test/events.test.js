const test = require('node:test');
const assert = require('node:assert/strict');
const { createStreamParser, translate, SENTINEL } = require('../main/playwright/events');

const line = (record) => SENTINEL + JSON.stringify(record) + '\n';

test('el parser ignora las líneas sin sentinela', () => {
  const seen = [];
  const feed = createStreamParser((r) => seen.push(r));
  feed('[Reporter] Resultados guardados\n');
  feed(line({ type: 'begin', total: 3 }));
  assert.deepEqual(seen, [{ type: 'begin', total: 3 }]);
});

test('el parser reensambla una línea partida a la mitad', () => {
  const seen = [];
  const feed = createStreamParser((r) => seen.push(r));
  const whole = line({ type: 'begin', total: 5 });
  feed(whole.slice(0, 12));
  feed(whole.slice(12));
  assert.deepEqual(seen, [{ type: 'begin', total: 5 }]);
});

test('el parser encuentra el sentinela aunque haya texto antes', () => {
  const seen = [];
  const feed = createStreamParser((r) => seen.push(r));
  feed('salida del test' + line({ type: 'end', status: 'passed', durationMs: 10 }));
  assert.equal(seen.length, 1);
});

test('el parser descarta JSON corrupto sin romperse', () => {
  const seen = [];
  const feed = createStreamParser((r) => seen.push(r));
  feed(SENTINEL + '{roto\n');
  feed(line({ type: 'begin', total: 1 }));
  assert.deepEqual(seen, [{ type: 'begin', total: 1 }]);
});

test('testBegin marca la prueba como corriendo', () => {
  assert.deepEqual(translate({ type: 'testBegin', id: 'a.spec.ts:3', name: 'x', retry: 0 }), [
    { channel: 'run:testResult', payload: { id: 'a.spec.ts:3', status: 'running' } },
  ]);
});

test('una prueba que pasa emite log verde y resultado', () => {
  const out = translate({ type: 'testEnd', id: 'a.spec.ts:3', name: 'suma', status: 'passed', retry: 0 });
  assert.deepEqual(out, [
    { channel: 'run:log', payload: { level: 'pass', text: 'suma' } },
    { channel: 'run:testResult', payload: { id: 'a.spec.ts:3', status: 'passed' } },
  ]);
});

test('una prueba que falla emite log rojo con el error', () => {
  const out = translate({
    type: 'testEnd', id: 'a.spec.ts:9', name: 'falla', status: 'failed', retry: 0, willRetry: false,
    error: 'expected 2 received 1',
  });
  assert.deepEqual(out, [
    { channel: 'run:log', payload: { level: 'fail', text: 'falla — expected 2 received 1' } },
    { channel: 'run:testResult', payload: { id: 'a.spec.ts:9', status: 'failed' } },
  ]);
});

test('timedOut e interrupted también cuentan como fallo', () => {
  for (const status of ['timedOut', 'interrupted']) {
    const out = translate({ type: 'testEnd', id: 'a:1', name: 'x', status, retry: 0, willRetry: false, error: null });
    assert.equal(out.at(-1).payload.status, 'failed');
  }
});

test('una prueba que va a reintentarse no marca resultado todavía', () => {
  const out = translate({ type: 'testEnd', id: 'a:1', name: 'inestable', status: 'failed', retry: 0, willRetry: true, error: 'boom' });
  assert.deepEqual(out, [
    { channel: 'run:log', payload: { level: 'muted', text: 'inestable — falló, reintentando…' } },
  ]);
});

test('una prueba que pasa en el reintento se anuncia como inestable', () => {
  const out = translate({ type: 'testEnd', id: 'a:1', name: 'resta', status: 'passed', retry: 1 });
  assert.deepEqual(out[0], {
    channel: 'run:log',
    payload: { level: 'muted', text: 'resta — inestable: pasó en el reintento' },
  });
  assert.equal(out.at(-1).payload.status, 'passed');
});

test('una prueba omitida solo deja rastro en la consola', () => {
  const out = translate({ type: 'testEnd', id: 'a:1', name: 'resta', status: 'skipped', retry: 0, willRetry: false });
  assert.deepEqual(out, [{ channel: 'run:log', payload: { level: 'muted', text: 'resta — omitida' } }]);
});

test('el stdout de una prueba se muestra en gris', () => {
  assert.deepEqual(translate({ type: 'stdout', text: 'hola' }), [
    { channel: 'run:log', payload: { level: 'muted', text: 'hola' } },
  ]);
});

test('el stdout vacío no ensucia la consola', () => {
  assert.deepEqual(translate({ type: 'stdout', text: '' }), []);
});

test('begin y end no producen eventos de UI', () => {
  assert.deepEqual(translate({ type: 'begin', total: 3 }), []);
  assert.deepEqual(translate({ type: 'end', status: 'passed', durationMs: 5 }), []);
});
