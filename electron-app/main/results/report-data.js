/**
 * Convierte una corrida guardada (`record`) + los valores del perfil en el mapa
 * de tokens de la plantilla de reporte RASI. Puro y testeable: sin Electron ni fs.
 * Todo valor dinámico va escapado para no romper el HTML de la plantilla.
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const pad = (n) => String(n).padStart(2, '0');

function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n >= 60000) return (n / 60000).toFixed(1) + 'm';
  return Math.round(n / 1000) + 's';
}

/** Nombre del PDF con la fecha/hora de ejecución: `ReporteE2E_YYYYMMDD_HHMM.pdf`. */
function reportFileName(finishedAt) {
  const dt = new Date(finishedAt);
  const stamp = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}_${pad(dt.getHours())}${pad(dt.getMinutes())}`;
  return `ReporteE2E_${stamp}.pdf`;
}

function moduleOf(id) {
  return String(id).replace(/:\d+$/, '').replace(/\.spec\.[jt]sx?$/, '').replace(/\.[jt]sx?$/, '');
}

function fileOf(id) {
  return 'tests/' + String(id).replace(/:\d+$/, '');
}

const isFailed = (t) => t.status !== 'passed' && t.status !== 'skipped';
const isFlaky = (t) => t.status === 'passed' && (Number(t.retry) || 0) > 0;

function statusLabel(t) {
  if (t.status === 'skipped') return 'SKIP';
  if (isFailed(t)) return 'FALLO';
  return isFlaky(t) ? 'FLAKY' : 'OK';
}

function errorType(msg) {
  return /timeout/i.test(String(msg || '')) ? 'Timeout' : 'Error';
}

function probableCause(msg) {
  return /timeout/i.test(String(msg || '')) ? 'Servidor lento / Timing' : 'Por revisar';
}

function buildTablaModulos(tests) {
  const groups = new Map();
  for (const t of tests) {
    const mod = moduleOf(t.id);
    if (!groups.has(mod)) groups.set(mod, []);
    groups.get(mod).push(t);
  }
  const lines = [];
  let tN = 0, tOk = 0, tFail = 0, tFlaky = 0;
  for (const mod of [...groups.keys()].sort((a, b) => a.localeCompare(b, 'es'))) {
    const list = groups.get(mod);
    const ok = list.filter((t) => t.status === 'passed').length;
    const fail = list.filter(isFailed).length;
    const flaky = list.filter(isFlaky).length;
    tN += list.length; tOk += ok; tFail += fail; tFlaky += flaky;
    lines.push(`${esc(mod)}: ${list.length} tests, ${ok} OK, ${fail} fallaron, ${flaky} flaky - ${fail > 0 ? 'FALLO' : 'OK'}`);
  }
  lines.push('');
  lines.push(`TOTAL: ${tN} tests, ${tOk} OK, ${tFail} fallaron, ${tFlaky} flaky`);
  return lines.join('<br>');
}

function buildDetalleTests(tests) {
  return tests
    .map((t) => `[${statusLabel(t)}]  &gt; ${esc(t.id)} &gt; ${esc(t.name)} (${Number(t.durationMs) || 0}ms)`)
    .join('<br>');
}

function buildDetalleFallos(tests) {
  const failed = tests.filter(isFailed);
  if (failed.length === 0) return 'Sin fallos';
  return failed.map((t, i) => [
    `Fallo ${i + 1}:`,
    `&nbsp; Test: ${esc(t.name)}`,
    `&nbsp; Módulo: ${esc(moduleOf(t.id))}`,
    `&nbsp; Archivo: ${esc(fileOf(t.id))}`,
    `&nbsp; Error: ${esc(t.error || 'Sin mensaje de error')}`,
    `&nbsp; Tipo: ${errorType(t.error)}`,
    `&nbsp; Screenshot: Ver carpeta test-results/`,
    `&nbsp; Consistente: No verificado`,
    `&nbsp; Causa probable: ${probableCause(t.error)}`,
  ].join('<br>')).join('<br><br>');
}

function buildDetalleFlaky(tests) {
  const flaky = tests.filter(isFlaky);
  if (flaky.length === 0) return 'Sin tests inestables';
  return flaky.map((t) => `${esc(t.name)} — pasó en el reintento (retry ${Number(t.retry) || 0})`).join('<br>');
}

function buildAcciones(failedCount) {
  if (failedCount > 0) {
    return '- Reportar fallos al desarrollador<br>- Adjuntar evidencia (screenshots, trace) al ticket/reporte';
  }
  return '- Ejecución exitosa, sin acciones pendientes';
}

function buildReportTokens(record, profileValues) {
  const tests = record.tests || [];
  const s = record.summary || { total: 0, passed: 0, failed: 0, skipped: 0 };
  const flakyCount = tests.filter(isFlaky).length;
  const dt = new Date(record.finishedAt);
  const nombre = (profileValues && profileValues.QA_NOMBRE) || record.profileName || '';
  const cargo = (profileValues && profileValues.QA_CARGO) || '';
  const fecha = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

  return {
    FECHA: fecha,
    HORA: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
    EJECUTADO_POR: esc(nombre),
    PERFIL: esc(record.profileId || ''),
    AMBIENTE: '',
    URL_SERVIDOR: '',
    VERSION_ERP: '',
    TOTAL_TESTS: s.total,
    PASSED: s.passed,
    FAILED: s.failed,
    SKIPPED: s.skipped,
    FLAKY: flakyCount,
    DURACION: formatDuration(record.durationMs),
    RESULTADO_GENERAL: s.failed > 0 ? 'CON FALLOS' : 'TODOS OK',
    TABLA_MODULOS: buildTablaModulos(tests),
    DETALLE_TESTS: buildDetalleTests(tests),
    DETALLE_FALLOS: buildDetalleFallos(tests),
    DETALLE_FLAKY: buildDetalleFlaky(tests),
    OBSERVACIONES: 'Sin observaciones',
    ACCIONES: buildAcciones(s.failed),
    FIRMA_NOMBRE: esc(nombre),
    FIRMA_CARGO: esc(cargo),
    FIRMA_FECHA: fecha,
  };
}

module.exports = {
  buildReportTokens, reportFileName, formatDuration, moduleOf, fileOf, isFlaky, isFailed,
  errorType, probableCause, buildTablaModulos, buildDetalleTests,
  buildDetalleFallos, buildDetalleFlaky, buildAcciones,
};
