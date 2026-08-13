const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReportPayload } = require('../main/results/n8n-payload');

/** Registro como el que arma `results:save`, con lo mínimo para leerlo de un vistazo. */
function unRegistro(extra = {}) {
  return {
    id: 'run-1',
    projectId: 'erp',
    projectName: 'RASI ERP',
    profileId: 'Nelson_vid',
    profileName: 'Nelson Rosas',
    startedAt: '2026-08-13T12:00:00.000Z',
    finishedAt: '2026-08-13T12:03:42.000Z',
    durationMs: 222000,
    mode: 'conjunto',
    runAll: true,
    options: { visualMode: false, stopOnFail: false },
    summary: { total: 3, passed: 2, failed: 1, skipped: 0 },
    tests: [
      { id: 'login/login.spec.ts:4', name: 'ingresar con credenciales válidas', status: 'passed', durationMs: 5210, error: null },
      { id: 'cartera/consulta.spec.ts:12', name: 'consultar saldo', status: 'passed', durationMs: 8090, error: null },
      { id: 'cartera/pago.spec.ts:8', name: 'pago rechazado', status: 'failed', durationMs: 3400, error: 'AssertionError: no coincide' },
    ],
    report: null,
    ...extra,
  };
}

const valores = {
  QA_NOMBRE: 'Nelson Rosas',
  QA_CARGO: 'Desarrollador',
  AMBIENTE: 'Produccion',
  ERP_VERSION: '3.6.7_05',
  BASE_URL: 'https://testing.rasi.net.co/etic/admin/index3.jsp',
  GOOGLE_TEMPLATE_DOC_ID: 'plantilla-123',
  GOOGLE_DRIVE_FOLDER_ID: 'carpeta-456',
};

test('arma las nueve secciones que el flujo de n8n espera', () => {
  const p = buildReportPayload(unRegistro(), valores);
  assert.deepEqual(Object.keys(p), [
    'templateDocId', 'driveFolderId', 'informacionGeneral', 'resumen', 'resultadosPorModulo',
    'detalleTests', 'testsFallidos', 'testsFlaky', 'observaciones',
    'accionesSeguimiento', 'firma',
  ]);
});

test('informacionGeneral sale del perfil y del registro', () => {
  const p = buildReportPayload(unRegistro(), valores);
  assert.deepEqual(p.informacionGeneral, {
    fechaEjecucion: '2026-08-13',
    horaEjecucion: '07:03',            // 12:03 UTC en hora de Colombia
    ejecutadoPor: 'Nelson Rosas',
    perfilUtilizado: 'Nelson_vid',
    ambiente: 'Produccion',
    urlServidor: 'https://testing.rasi.net.co/etic/admin/index3.jsp',
    versionERP: '3.6.7_05',
    proyecto: 'RASI ERP',
  });
});

test('la plantilla de Drive viaja como templateDocId', () => {
  assert.equal(buildReportPayload(unRegistro(), valores).templateDocId, 'plantilla-123');
});

test('la carpeta de Drive viaja como driveFolderId', () => {
  assert.equal(buildReportPayload(unRegistro(), valores).driveFolderId, 'carpeta-456');
});

test('la firma toma nombre y cargo del perfil', () => {
  assert.deepEqual(buildReportPayload(unRegistro(), valores).firma, {
    elaboradoPor: 'Nelson Rosas',
    cargo: 'Desarrollador',
    fecha: '2026-08-13',
  });
});

test('sin QA_CARGO en el perfil, la firma cae en "QA Tester"', () => {
  const { QA_CARGO, ...sinCargo } = valores;
  assert.equal(buildReportPayload(unRegistro(), sinCargo).firma.cargo, 'QA Tester');
});

test('sin QA_NOMBRE usa el nombre del perfil que ya trae el registro', () => {
  const { QA_NOMBRE, ...sinNombre } = valores;
  const p = buildReportPayload(unRegistro(), sinNombre);
  assert.equal(p.informacionGeneral.ejecutadoPor, 'Nelson Rosas');
});

test('un perfil vacío no rompe: las claves quedan en blanco, no en undefined', () => {
  const p = buildReportPayload(unRegistro({ profileName: null }), {});
  assert.equal(p.templateDocId, '');
  assert.equal(p.driveFolderId, '');
  assert.equal(p.informacionGeneral.urlServidor, '');
  assert.equal(p.informacionGeneral.versionERP, '');
  assert.equal(p.informacionGeneral.ambiente, 'Produccion');
  assert.equal(p.informacionGeneral.ejecutadoPor, 'Nelson_vid');
});

test('el resumen traduce el summary y marca CON FALLOS si hay alguno', () => {
  const p = buildReportPayload(unRegistro(), valores);
  assert.deepEqual(p.resumen, {
    totalTests: 3, passed: 2, failed: 1, flaky: 0, skipped: 0,
    duracionTotal: '3m 42s',
    resultadoGeneral: 'CON FALLOS',
  });
});

test('sin fallos el resultado general es EXITOSO', () => {
  const verde = unRegistro({
    summary: { total: 2, passed: 2, failed: 0, skipped: 0 },
    tests: [
      { id: 'login/login.spec.ts:4', name: 'a', status: 'passed', durationMs: 1000, error: null },
      { id: 'login/salir.spec.ts:9', name: 'b', status: 'passed', durationMs: 2000, error: null },
    ],
  });
  assert.equal(buildReportPayload(verde, valores).resumen.resultadoGeneral, 'EXITOSO');
});

test('RunQA no distingue flaky: la sección va vacía y el contador en cero', () => {
  const p = buildReportPayload(unRegistro(), valores);
  assert.equal(p.resumen.flaky, 0);
  assert.deepEqual(p.testsFlaky, []);
});

test('duraciones cortas se expresan en segundos', () => {
  const corta = unRegistro({ durationMs: 8400 });
  assert.equal(buildReportPayload(corta, valores).resumen.duracionTotal, '8.4s');
});

test('agrupa por módulo tomando la carpeta del test', () => {
  const p = buildReportPayload(unRegistro(), valores);
  assert.deepEqual(p.resultadosPorModulo, [
    { modulo: 'login', tests: 1, passed: 1, failed: 0, flaky: 0, estado: 'OK' },
    { modulo: 'cartera', tests: 2, passed: 1, failed: 1, flaky: 0, estado: 'FALLO' },
  ]);
});

test('un test sin carpeta se agrupa por su archivo', () => {
  const suelto = unRegistro({
    summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    tests: [{ id: 'humo.spec.ts:3', name: 'humo', status: 'passed', durationMs: 900, error: null }],
  });
  assert.equal(buildReportPayload(suelto, valores).resultadosPorModulo[0].modulo, 'humo');
});

test('el detalle lista cada test con su duración legible', () => {
  const p = buildReportPayload(unRegistro(), valores);
  assert.deepEqual(p.detalleTests, [
    { nombre: 'ingresar con credenciales válidas', status: 'passed', duracion: '5.2s' },
    { nombre: 'consultar saldo', status: 'passed', duracion: '8.1s' },
    { nombre: 'pago rechazado', status: 'failed', duracion: '3.4s' },
  ]);
});

test('la sección de fallos describe cada test caído', () => {
  const p = buildReportPayload(unRegistro(), valores);
  assert.deepEqual(p.testsFallidos, [{
    test: 'pago rechazado',
    modulo: 'cartera',
    archivo: 'cartera/pago.spec.ts',
    mensajeError: 'AssertionError: no coincide',
    tipoFallo: 'Assertion',
    screenshot: '',
    falloConsistente: 'No verificado',
    posibleCausa: 'Por investigar',
  }]);
});

test('un timeout se clasifica como tal y sugiere la causa', () => {
  const lento = unRegistro({
    summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
    tests: [{ id: 'cartera/pago.spec.ts:8', name: 'pago', status: 'failed', durationMs: 30000,
      error: 'TimeoutError: Timeout 30000ms exceeded' }],
  });
  const fallo = buildReportPayload(lento, valores).testsFallidos[0];
  assert.equal(fallo.tipoFallo, 'Timeout');
  assert.equal(fallo.posibleCausa, 'Servidor lento / Timing');
});

test('un fallo sin mensaje no deja el campo en undefined', () => {
  const mudo = unRegistro({
    summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
    tests: [{ id: 'cartera/pago.spec.ts:8', name: 'pago', status: 'failed', durationMs: 10, error: null }],
  });
  assert.equal(buildReportPayload(mudo, valores).testsFallidos[0].mensajeError, '');
});

test('con fallos, las acciones piden reportar y adjuntar evidencia', () => {
  assert.deepEqual(buildReportPayload(unRegistro(), valores).accionesSeguimiento, [
    'Reportar fallos al desarrollador',
    'Adjuntar evidencia (screenshots, trace) al ticket/reporte',
  ]);
});

test('sin fallos, las acciones lo dicen explícitamente', () => {
  const verde = unRegistro({
    summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    tests: [{ id: 'login/login.spec.ts:4', name: 'a', status: 'passed', durationMs: 1000, error: null }],
  });
  assert.deepEqual(buildReportPayload(verde, valores).accionesSeguimiento, [
    'No se requiere accion — todos los tests pasaron',
  ]);
});

test('las observaciones del QA viajan en la sección 7', () => {
  const p = buildReportPayload(unRegistro(), valores, { observaciones: 'Servidor lento toda la mañana' });
  assert.equal(p.observaciones, 'Servidor lento toda la mañana');
});
