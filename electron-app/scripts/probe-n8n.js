#!/usr/bin/env node
/**
 * Sonda del webhook de n8n. Manda un registro de corrida con la MISMA forma y por
 * el MISMO camino que RunQA: reusa `main/results/notify-n8n.js`, así que lo que
 * imprime es lo que la app sellaría en `record.n8n`. Sirve para probar el flujo
 * sin abrir la app ni correr una suite de verdad.
 *
 * Uso:
 *   npm run probe-n8n -- https://n8n.tu-servidor/webhook/...
 *   N8N_WEBHOOK_URL=... npm run probe-n8n
 *
 * Opciones:
 *   --verde    todas las pruebas pasan (por defecto va con 1 fallo, que es el
 *              caso interesante para el documento)
 *
 * Sale con 0 si el webhook aceptó el envío, 1 si no.
 */

const { notifyN8n } = require('../main/results/notify-n8n');
const { buildReportPayload } = require('../main/results/n8n-payload');

const args = process.argv.slice(2);
const verde = args.includes('--verde');
const url = args.find((a) => a.startsWith('http')) || process.env.N8N_WEBHOOK_URL;

if (!url) {
  console.error('Falta la URL del webhook: npm run probe-n8n -- https://n8n.../webhook/...');
  process.exit(2);
}

const startedAt = new Date(Date.now() - 222000).toISOString();
const finishedAt = new Date().toISOString();
const runId = `run-${Date.now()}`;

const fallo = {
  id: 'cartera/pago.spec.ts:8',
  name: 'pago rechazado muestra el motivo',
  status: 'failed',
  durationMs: 3400,
  error: 'AssertionError: el resultado no coincide con lo esperado',
};

const tests = [
  { id: 'login/login.spec.ts:4', name: 'ingresar con credenciales válidas', status: 'passed', durationMs: 5210, error: null },
  { id: 'cartera/consulta.spec.ts:12', name: 'consultar saldo de cliente', status: 'passed', durationMs: 8090, error: null },
  verde ? { ...fallo, status: 'passed', error: null } : fallo,
];

/** Mismo registro que arman `run:start` y `results:save` en main/ipc.js. */
const record = {
  id: runId,
  projectId: 'sonda',
  projectName: 'Sonda de n8n',
  profileId: 'qa-sonda',
  profileName: 'QA de prueba',
  startedAt,
  finishedAt,
  durationMs: 222000,
  mode: 'conjunto',
  runAll: true,
  options: { visualMode: false, stopOnFail: false },
  summary: {
    total: tests.length,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => t.status === 'failed').length,
    skipped: 0,
  },
  tests,
  report: { kind: 'template-pdf', path: `${runId}/reporte.pdf` },
  n8n: { sent: false, at: null, ok: null, error: null },
};

/**
 * Los valores que el reporte saca del perfil se leen del entorno, con las mismas
 * claves del `.env`:
 *   set -a; . .env.Nelson_vid; set +a; npm run probe-n8n -- $N8N_WEBHOOK_URL
 */
const valoresDelPerfil = {
  QA_NOMBRE: process.env.QA_NOMBRE,
  QA_CARGO: process.env.QA_CARGO,
  AMBIENTE: process.env.AMBIENTE,
  ERP_VERSION: process.env.ERP_VERSION,
  BASE_URL: process.env.BASE_URL,
  GOOGLE_TEMPLATE_DOC_ID: process.env.GOOGLE_TEMPLATE_DOC_ID,
  GOOGLE_DRIVE_FOLDER_ID: process.env.GOOGLE_DRIVE_FOLDER_ID,
};

(async () => {
  const payload = buildReportPayload(record, valoresDelPerfil, {
    observaciones: 'Envío de prueba desde la sonda de RunQA.',
  });

  console.log(`POST ${url}`);
  console.log(`Registro: ${record.summary.total} pruebas, ${record.summary.passed} ok, ${record.summary.failed} fallidas`);
  console.log(`Plantilla: ${payload.templateDocId || '(sin GOOGLE_TEMPLATE_DOC_ID en el entorno)'}`);
  console.log(`Carpeta:   ${payload.driveFolderId || '(sin GOOGLE_DRIVE_FOLDER_ID en el entorno)'}\n`);

  const inicio = Date.now();
  const res = await notifyN8n(payload, { url });
  console.log(`Respondió en ${Date.now() - inicio} ms\n`);

  console.log('Lo que RunQA sella en record.n8n:');
  console.log(JSON.stringify({ sent: true, at: res.at, ok: res.ok, docUrl: res.docUrl, status: res.status, body: res.body, error: res.error }, null, 2));

  if (res.ok) {
    console.log(`\n✓ Documento generado: ${res.docUrl}`);
  } else {
    console.log(`\n✗ Falló: ${res.error}`);
    console.log('  En RunQA esto deja la corrida guardada en local con el botón "Reenviar".');
  }
  process.exit(res.ok ? 0 : 1);
})();
