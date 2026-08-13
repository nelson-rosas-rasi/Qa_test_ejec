/**
 * Traduce un registro de corrida al payload de nueve secciones que espera el
 * flujo de n8n (el que duplica la plantilla de Google Docs).
 *
 * El contrato NO lo define RunQA: lo define `scripts/send-report.js`, que vive
 * en los repos de pruebas (`medical-e2e`, `rasierp-e2e` — el archivo es idéntico
 * en los dos) y es lo que el flujo viene recibiendo desde antes que existiera
 * esta app. Mandar el registro interno de RunQA hacía que n8n contestara 200 y
 * fallara en un nodo intermedio, sin documento y sin aviso.
 *
 * Los datos que el registro no tiene (plantilla, ambiente, versión, servidor,
 * cargo) salen del `.env` del perfil, que RunQA ya administra.
 *
 * Puro: sin fs, sin red, sin Electron.
 */

/** El equipo de QA está en Colombia; fecha y hora del reporte van en su huso. */
const HUSO = 'America/Bogota';

function partesDeFecha(iso) {
  const fmt = new Intl.DateTimeFormat('es-CO', {
    timeZone: HUSO,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    // Intl devuelve "24" para la medianoche en hour12:false; el reporte quiere "00".
    hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`,
  };
}

/** Duraciones como las escribe una persona: "3m 42s" de un minuto para arriba. */
function duracion(ms) {
  const total = Math.max(0, Number(ms) || 0);
  if (total < 60000) return `${(total / 1000).toFixed(1)}s`;
  return `${Math.floor(total / 60000)}m ${Math.round((total % 60000) / 1000)}s`;
}

/**
 * El módulo es la carpeta del test: "cartera/pago.spec.ts:8" → "cartera". Los
 * tests sueltos en la raíz se agrupan por su archivo, para que la sección 3 del
 * reporte no quede con una fila sin nombre.
 */
function moduloDe(testId) {
  const ruta = String(testId || '').replace(/:\d+$/, '');
  const barra = ruta.indexOf('/');
  if (barra > 0) return ruta.slice(0, barra);
  return ruta.split('.')[0] || 'sin módulo';
}

/** Agrupa por módulo respetando el orden en que aparecen los tests. */
function porModulo(tests) {
  const orden = [];
  const acc = new Map();
  for (const t of tests) {
    const modulo = moduloDe(t.id);
    if (!acc.has(modulo)) {
      acc.set(modulo, { modulo, tests: 0, passed: 0, failed: 0, flaky: 0, estado: 'OK' });
      orden.push(modulo);
    }
    const fila = acc.get(modulo);
    fila.tests += 1;
    if (t.status === 'passed') fila.passed += 1;
    if (t.status === 'failed') fila.failed += 1;
    fila.estado = fila.failed > 0 ? 'FALLO' : 'OK';
  }
  return orden.map((m) => acc.get(m));
}

/**
 * RunQA solo guarda el mensaje del error, no el tipo que clasificaba el reporter
 * del repo. Un timeout se reconoce por el mensaje; lo demás queda como fallo de
 * aserción, que es la otra mitad de los casos reales.
 */
function tipoDeFallo(mensaje) {
  return /timeout/i.test(mensaje || '') ? 'Timeout' : 'Assertion';
}

function fallosDe(tests) {
  return tests.filter((t) => t.status === 'failed').map((t) => {
    const tipoFallo = tipoDeFallo(t.error);
    return {
      test: t.name,
      modulo: moduloDe(t.id),
      archivo: String(t.id || '').replace(/:\d+$/, ''),
      mensajeError: t.error || '',
      tipoFallo,
      // RunQA todavía no adjunta capturas al registro (ver pieza F del roadmap).
      screenshot: '',
      falloConsistente: 'No verificado',
      posibleCausa: tipoFallo === 'Timeout' ? 'Servidor lento / Timing' : 'Por investigar',
    };
  });
}

function accionesDe(failed) {
  if (failed === 0) return ['No se requiere accion — todos los tests pasaron'];
  return [
    'Reportar fallos al desarrollador',
    'Adjuntar evidencia (screenshots, trace) al ticket/reporte',
  ];
}

/**
 * @param {object} record  registro de corrida (main/ipc.js → results:save)
 * @param {object} values  valores del `.env` del perfil
 * @param {{observaciones?: string}} [opciones]
 */
function buildReportPayload(record, values = {}, opciones = {}) {
  const { fecha, hora } = partesDeFecha(record.finishedAt);
  const quien = values.QA_NOMBRE || record.profileName || record.profileId || '';

  return {
    templateDocId: values.GOOGLE_TEMPLATE_DOC_ID || '',
    // Carpeta de Drive donde debe quedar el documento. `scripts/send-report.js`
    // nunca la mandó (el flujo la tiene fija), así que viaja para que el nodo de
    // Drive pueda leerla; hasta que se conecte allá, n8n la ignora sin romperse.
    driveFolderId: values.GOOGLE_DRIVE_FOLDER_ID || '',

    informacionGeneral: {
      fechaEjecucion: fecha,
      horaEjecucion: hora,
      ejecutadoPor: quien,
      perfilUtilizado: record.profileId || '',
      ambiente: values.AMBIENTE || 'Produccion',
      urlServidor: values.BASE_URL || '',
      versionERP: values.ERP_VERSION || '',
      proyecto: record.projectName || '',
    },

    resumen: {
      totalTests: record.summary.total,
      passed: record.summary.passed,
      failed: record.summary.failed,
      // RunQA no reintenta ni marca flaky: la sección existe para no romper el
      // contrato, siempre en cero.
      flaky: 0,
      skipped: record.summary.skipped,
      duracionTotal: duracion(record.durationMs),
      resultadoGeneral: record.summary.failed > 0 ? 'CON FALLOS' : 'EXITOSO',
    },

    resultadosPorModulo: porModulo(record.tests || []),

    detalleTests: (record.tests || []).map((t) => ({
      nombre: t.name,
      status: t.status,
      duracion: duracion(t.durationMs),
    })),

    testsFallidos: fallosDe(record.tests || []),
    testsFlaky: [],
    observaciones: opciones.observaciones || '',
    accionesSeguimiento: accionesDe(record.summary.failed),

    firma: {
      elaboradoPor: quien,
      cargo: values.QA_CARGO || 'QA Tester',
      fecha,
    },
  };
}

module.exports = { buildReportPayload };
