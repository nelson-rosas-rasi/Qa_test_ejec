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
 * `notifyN8n` descarta el cuerpo de la respuesta — le alcanza con el `ok`. Acá se
 * envuelve el fetch global para leerlo sin mandar un segundo POST, que en n8n
 * sería un segundo documento.
 */
let respuesta = null;
const fetchEspia = async (u, opts) => {
  const res = await fetch(u, opts);
  const texto = await res.clone().text().catch(() => '');
  respuesta = { status: res.status, cuerpo: texto };
  return res;
};

(async () => {
  console.log(`POST ${url}`);
  console.log(`Registro: ${record.summary.total} pruebas, ${record.summary.passed} ok, ${record.summary.failed} fallidas\n`);

  const inicio = Date.now();
  const res = await notifyN8n(record, { url, fetchImpl: fetchEspia });
  const ms = Date.now() - inicio;

  if (respuesta) {
    console.log(`HTTP ${respuesta.status} en ${ms} ms`);
    console.log(respuesta.cuerpo ? `Respuesta:\n${respuesta.cuerpo.slice(0, 2000)}\n` : 'Respuesta: (vacía)\n');
  }

  console.log('Lo que RunQA sellaría en record.n8n:');
  console.log(JSON.stringify({ sent: true, at: res.at, ok: res.ok, error: res.error }, null, 2));

  if (res.ok) {
    console.log('\n✓ El webhook aceptó el envío. Revisá en n8n que el documento se haya generado.');
  } else {
    console.log(`\n✗ Falló: ${res.error}`);
    console.log('  En RunQA esto deja la corrida guardada en local con el botón "Reenviar".');
  }
  process.exit(res.ok ? 0 : 1);
})();
