const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReportTokens, reportFileName, formatDuration, moduleOf, fileOf, buildDetalleFallos, buildAcciones,
} = require('../main/results/report-data');

const record = {
  finishedAt: '2026-07-14T16:55:00.000Z',
  profileId: 'kvergel_vid',
  profileName: 'Kevin Vergel',
  durationMs: 162000,
  summary: { total: 4, passed: 2, failed: 1, skipped: 1 },
  tests: [
    { id: 'atencion/flujo-a.spec.ts:10', name: 'Flujo A', status: 'passed', durationMs: 1000, retry: 0 },
    { id: 'atencion/flujo-b.spec.ts:20', name: 'Flujo B', status: 'passed', durationMs: 2000, retry: 1 },
    { id: 'cartera/nota.spec.ts:5', name: 'Nota credito', status: 'failed', durationMs: 8804, error: 'TimeoutError: page.waitForFunction: Timeout 20000ms exceeded.', retry: 0 },
    { id: 'cartera/skip.spec.ts:8', name: 'Skip test', status: 'skipped', durationMs: 0, retry: 0 },
  ],
};
const profileValues = { QA_NOMBRE: 'Kevin Vergel', QA_CARGO: 'QA Tester' };

test('formatDuration: minutos y segundos', () => {
  assert.equal(formatDuration(162000), '2.7m');
  assert.equal(formatDuration(90000), '1.5m');
  assert.equal(formatDuration(30000), '30s');
  assert.equal(formatDuration(0), '0s');
});

test('reportFileName usa la fecha/hora de ejecución', () => {
  assert.match(reportFileName('2026-07-14T16:55:00.000Z'), /^ReporteE2E_\d{8}_\d{4}\.pdf$/);
});

test('moduleOf / fileOf', () => {
  assert.equal(moduleOf('cartera/nota.spec.ts:5'), 'cartera/nota');
  assert.equal(fileOf('cartera/nota.spec.ts:5'), 'tests/cartera/nota.spec.ts');
});

test('resumen: totales y flaky', () => {
  const t = buildReportTokens(record, profileValues);
  assert.equal(t.TOTAL_TESTS, 4);
  assert.equal(t.PASSED, 2);
  assert.equal(t.FAILED, 1);
  assert.equal(t.SKIPPED, 1);
  assert.equal(t.FLAKY, 1);
  assert.equal(t.DURACION, '2.7m');
  assert.equal(t.RESULTADO_GENERAL, 'CON FALLOS');
});

test('info general y firma desde perfil', () => {
  const t = buildReportTokens(record, profileValues);
  assert.equal(t.EJECUTADO_POR, 'Kevin Vergel');
  assert.equal(t.PERFIL, 'kvergel_vid');
  assert.equal(t.FIRMA_NOMBRE, 'Kevin Vergel');
  assert.equal(t.FIRMA_CARGO, 'QA Tester');
  assert.match(t.FECHA, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(t.HORA, /^\d{2}:\d{2}$/);
  assert.equal(t.AMBIENTE, '');
  assert.equal(t.URL_SERVIDOR, '');
  assert.equal(t.VERSION_ERP, '');
});

test('tabla de módulos con TOTAL', () => {
  const t = buildReportTokens(record, profileValues);
  assert.match(t.TABLA_MODULOS, /TOTAL: 4 tests, 2 OK, 1 fallaron, 1 flaky/);
});

test('detalle de fallos con tipo/causa', () => {
  const t = buildReportTokens(record, profileValues);
  assert.match(t.DETALLE_FALLOS, /Nota credito/);
  assert.match(t.DETALLE_FALLOS, /Módulo: cartera\/nota/);
  assert.match(t.DETALLE_FALLOS, /Tipo: Timeout/);
  assert.match(t.DETALLE_FALLOS, /Causa probable: Servidor lento/);
});

test('flaky y acciones', () => {
  const t = buildReportTokens(record, profileValues);
  assert.match(t.DETALLE_FLAKY, /Flujo B/);
  assert.match(t.ACCIONES, /Reportar fallos/);
});

test('sin fallos → "Sin fallos" y acción de éxito', () => {
  assert.equal(buildDetalleFallos([]), 'Sin fallos');
  assert.match(buildAcciones(0), /sin acciones pendientes/);
});

test('perfil ausente no rompe (usa profileName, cargo vacío)', () => {
  const t = buildReportTokens(record, null);
  assert.equal(t.EJECUTADO_POR, 'Kevin Vergel');
  assert.equal(t.FIRMA_CARGO, '');
});
