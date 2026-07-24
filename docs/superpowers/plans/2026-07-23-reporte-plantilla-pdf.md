# Reporte local con plantilla (PDF) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al guardar una corrida, generar un PDF con la plantilla RASI rellenando sus `{{tokens}}` con los datos de la corrida + el `.env` del perfil; el PDF pasa a ser el reporte local principal y el HTML de Playwright queda como secundario.

**Architecture:** Lógica pura y testeable en `main/results/report-data.js` (arma los tokens) y `report-html.js` (rellena la plantilla + logo). Un módulo delgado `report-pdf.js` usa `BrowserWindow.webContents.printToPDF()` de Electron (sin dependencias nuevas). `results:save` en `ipc.js` orquesta: arma tokens → rellena `report-template.html` → PDF. Se persiste `retry` por test para calcular flaky.

**Tech Stack:** Electron 30 (`printToPDF`), Node `node:test`, HTML/CSS inline para la plantilla.

## Global Constraints

- **NO commitear ni subir nada.** Trabajar solo en el working tree. Para revisar, snapshots (`diff -u`), no `git diff`.
- `npm test` desde `Qa_test_ejec/electron-app`. Estado base: **148/148 en verde**; ninguna tarea debe romper tests existentes.
- Tests nuevos con estilo del repo: `node:test` + `node:assert/strict`, temp dirs, sin dependencias.
- Los valores dinámicos que entran a la plantilla van **escapados** (evitar romper el HTML).
- Campos `AMBIENTE`, `URL_SERVIDOR`, `VERSION_ERP` → **en blanco** por ahora.
- Textos en español.

**Rutas base:** relativas a `Qa_test_ejec/electron-app/`.

---

### Task 1: `report-data.js` — armar los tokens desde la corrida

Módulo puro que convierte `record` + valores del perfil en el mapa de tokens de la plantilla.

**Files:**
- Create: `main/results/report-data.js`
- Test: `test/report-data.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `buildReportTokens(record, profileValues) -> { FECHA, HORA, EJECUTADO_POR, PERFIL, AMBIENTE, URL_SERVIDOR, VERSION_ERP, TOTAL_TESTS, PASSED, FAILED, SKIPPED, FLAKY, DURACION, RESULTADO_GENERAL, TABLA_MODULOS, DETALLE_TESTS, DETALLE_FALLOS, DETALLE_FLAKY, OBSERVACIONES, ACCIONES, FIRMA_NOMBRE, FIRMA_CARGO, FIRMA_FECHA }` (strings/números ya formateados y escapados). También exporta helpers `formatDuration`, `moduleOf`, `fileOf`, `isFlaky`, `buildDetalleFallos`, etc.

- [ ] **Step 1: Escribir el test que falla**

Create `test/report-data.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReportTokens, formatDuration, moduleOf, fileOf, buildDetalleFallos, buildAcciones,
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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/results/report-data'`.

- [ ] **Step 3: Escribir el módulo**

Create `main/results/report-data.js`:

```js
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
    .map((t) => `[${statusLabel(t)}]  ${esc(t.id)} &gt; ${esc(t.name)} (${Number(t.durationMs) || 0}ms)`)
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
  buildReportTokens, formatDuration, moduleOf, fileOf, isFlaky, isFailed,
  errorType, probableCause, buildTablaModulos, buildDetalleTests,
  buildDetalleFallos, buildDetalleFlaky, buildAcciones,
};
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS — los tests nuevos verdes y los 148 previos siguen verdes.

- [ ] **Step 5: Verificar working tree (sin commitear)**

Run: `git status --short` (solo inspección; **no** `git add`/`commit`).

---

### Task 2: `report-html.js` — rellenar la plantilla y el logo

**Files:**
- Create: `main/results/report-html.js`
- Test: `test/report-html.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `fillTemplate(templateHtml, tokens) -> string` (reemplaza `{{TOKEN}}`; ausente → ''); `logoHtml(assetsDir?) -> string` (`<img data-uri>` o '' si falta el png).

- [ ] **Step 1: Escribir el test que falla**

Create `test/report-html.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fillTemplate, logoHtml } = require('../main/results/report-html');

test('fillTemplate reemplaza tokens presentes', () => {
  assert.equal(fillTemplate('a {{X}} b {{Y}}', { X: '1', Y: '2' }), 'a 1 b 2');
});

test('fillTemplate deja vacío el token ausente', () => {
  assert.equal(fillTemplate('a {{X}} b {{Y}}', { X: '1' }), 'a 1 b ');
});

test('fillTemplate acepta números y 0', () => {
  assert.equal(fillTemplate('{{N}}', { N: 0 }), '0');
});

test('logoHtml devuelve <img> data-uri cuando existe el png', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-logo-'));
  fs.writeFileSync(path.join(dir, 'rasi-logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const html = logoHtml(dir);
  assert.match(html, /^<img /);
  assert.match(html, /data:image\/png;base64,/);
});

test('logoHtml devuelve "" cuando falta el png', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-logo-'));
  assert.equal(logoHtml(dir), '');
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/results/report-html'`.

- [ ] **Step 3: Escribir el módulo**

Create `main/results/report-html.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

/** Reemplaza cada `{{TOKEN}}` por su valor; un token ausente/nulo queda vacío. */
function fillTemplate(templateHtml, tokens) {
  return String(templateHtml).replace(/\{\{(\w+)\}\}/g, (_, key) =>
    (key in tokens && tokens[key] != null) ? String(tokens[key]) : '');
}

/** Lee `assets/rasi-logo.png` y lo devuelve como <img> con data URI, o '' si falta. */
function logoHtml(assetsDir = path.join(__dirname, 'assets')) {
  try {
    const buf = fs.readFileSync(path.join(assetsDir, 'rasi-logo.png'));
    return `<img src="data:image/png;base64,${buf.toString('base64')}" alt="RASI" style="height:56px">`;
  } catch {
    return '';
  }
}

module.exports = { fillTemplate, logoHtml };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Inspección working tree (sin commitear).**

---

### Task 3: Plantilla HTML + motor PDF + carpeta de assets

**Files:**
- Create: `main/results/report-template.html`
- Create: `main/results/report-pdf.js`
- Create: `main/results/assets/.gitkeep` (carpeta para el logo; el usuario coloca `rasi-logo.png`)

**Interfaces:**
- Consumes: `fillTemplate` (Task 2) — la plantilla debe usar exactamente los tokens que produce `buildReportTokens` (Task 1) + `{{LOGO}}`.
- Produces: `renderPdf({ html, htmlPath, pdfPath }) -> Promise<void>` (escribe `htmlPath` y genera `pdfPath` con `printToPDF`).

- [ ] **Step 1: Crear la plantilla**

Create `main/results/report-template.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; color: #000; font-size: 10pt; margin: 32px 40px; }
  .logo { text-align: right; margin-bottom: 8px; }
  h1.title { color: #1f4e79; font-size: 22pt; text-align: center; margin: 4px 0 0; }
  .subtitle { color: #2e75b6; font-size: 14pt; text-align: center; margin: 0 0 18px; }
  h1 { color: #1f4e79; font-size: 16pt; border-bottom: 1px solid #2e75b6; padding-bottom: 3px; margin: 22px 0 10px; }
  h3 { color: #2e75b6; font-size: 11pt; margin: 12px 0 4px; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; }
  th { background: #2e75b6; color: #fff; text-align: left; padding: 5px 8px; font-size: 10pt; }
  td { border: 1px solid #ccc; padding: 5px 8px; font-size: 10pt; vertical-align: top; }
  tr:nth-child(even) td { background: #f9f9f9; }
  tr:nth-child(odd) td { background: #f2f2f2; }
  .k { font-weight: 700; width: 32%; }
  .mono { font-family: 'Courier New', monospace; font-size: 9pt; color: #333; background: #f5f5f5; padding: 8px 10px; border: 1px solid #eee; white-space: normal; }
  .result { font-weight: 700; }
  .note { color: #2e75b6; font-style: italic; font-size: 9pt; background: #e8f4fd; padding: 8px 10px; margin-top: 18px; }
  .foot { color: #888; font-size: 8pt; text-align: center; margin-top: 18px; }
</style>
</head>
<body>
  <div class="logo">{{LOGO}}</div>
  <h1 class="title">Formato de Reporte de Ejecución E2E</h1>
  <div class="subtitle">RASI MEDICAL</div>

  <h1>1. Información general</h1>
  <table>
    <tr><th>Campo</th><th>Valor</th></tr>
    <tr><td class="k">Fecha de ejecución</td><td>{{FECHA}}</td></tr>
    <tr><td class="k">Hora de ejecución</td><td>{{HORA}}</td></tr>
    <tr><td class="k">Ejecutado por</td><td>{{EJECUTADO_POR}}</td></tr>
    <tr><td class="k">Perfil utilizado</td><td>{{PERFIL}}</td></tr>
    <tr><td class="k">Ambiente</td><td>{{AMBIENTE}}</td></tr>
    <tr><td class="k">URL del servidor</td><td>{{URL_SERVIDOR}}</td></tr>
    <tr><td class="k">Versión del ERP</td><td>{{VERSION_ERP}}</td></tr>
  </table>

  <h1>2. Resumen de resultados</h1>
  <table>
    <tr><th>Indicador</th><th>Cantidad</th></tr>
    <tr><td class="k">Total de tests</td><td>{{TOTAL_TESTS}}</td></tr>
    <tr><td class="k">Pasaron (passed)</td><td>{{PASSED}}</td></tr>
    <tr><td class="k">Fallaron (failed)</td><td>{{FAILED}}</td></tr>
    <tr><td class="k">Inestables (flaky)</td><td>{{FLAKY}}</td></tr>
    <tr><td class="k">Omitidos (skipped)</td><td>{{SKIPPED}}</td></tr>
    <tr><td class="k">Duración total</td><td>{{DURACION}}</td></tr>
  </table>
  <h3>Resultado general</h3>
  <p class="result">{{RESULTADO_GENERAL}}</p>

  <h1>3. Resultados por módulo</h1>
  <p class="mono">{{TABLA_MODULOS}}</p>

  <h1>4. Detalle de tests ejecutados</h1>
  <p class="mono">{{DETALLE_TESTS}}</p>

  <h1>5. Detalle de tests fallidos</h1>
  <p class="mono">{{DETALLE_FALLOS}}</p>

  <h1>6. Detalle de tests inestables (flaky)</h1>
  <p class="mono">{{DETALLE_FLAKY}}</p>

  <h1>7. Observaciones y notas</h1>
  <p>{{OBSERVACIONES}}</p>

  <h1>8. Acciones de seguimiento</h1>
  <p class="mono">{{ACCIONES}}</p>

  <h1>9. Firma</h1>
  <table>
    <tr><th>Campo</th><th>Valor</th></tr>
    <tr><td class="k">Elaborado por</td><td>{{FIRMA_NOMBRE}}</td></tr>
    <tr><td class="k">Cargo</td><td>{{FIRMA_CARGO}}</td></tr>
    <tr><td class="k">Fecha</td><td>{{FIRMA_FECHA}}</td></tr>
  </table>

  <p class="note">Recordatorio: para ver el reporte visual de Playwright con screenshots y traces, abre el "Reporte de Playwright" desde RunQA.</p>
  <p class="foot">Formato versión 1.0 — RASI Vida Medical — Equipo QA</p>
</body>
</html>
```

- [ ] **Step 2: Crear la carpeta de assets del logo**

Run: `mkdir -p main/results/assets && : > main/results/assets/.gitkeep`
(El usuario colocará luego `main/results/assets/rasi-logo.png`. Si falta, el header sale sin imagen.)

- [ ] **Step 3: Crear el motor PDF**

Create `main/results/report-pdf.js`:

```js
const fs = require('node:fs');

/**
 * Genera un PDF a partir de HTML usando una BrowserWindow oculta y printToPDF.
 * Escribe el HTML en `htmlPath` (autocontenido, con el logo embebido) y el PDF en
 * `pdfPath`. `electron` se requiere de forma perezosa: solo se usa en el main.
 */
async function renderPdf({ html, htmlPath, pdfPath }) {
  fs.writeFileSync(htmlPath, html, 'utf8');
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadFile(htmlPath);
    const pdf = await win.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(pdfPath, pdf);
  } finally {
    win.destroy();
  }
}

module.exports = { renderPdf };
```

- [ ] **Step 4: Verificación de sintaxis**

Run: `node --check main/results/report-pdf.js`
Expected: sin salida.
Run: `node -e "const {fillTemplate}=require('./main/results/report-html'); const fs=require('fs'); const html=fillTemplate(fs.readFileSync('main/results/report-template.html','utf8'),{TOTAL_TESTS:3,RESULTADO_GENERAL:'TODOS OK'}); if(html.includes('{{')) { console.error('quedaron tokens sin reemplazar de la lista dada (ok si son otros)'); } console.log('template OK, longitud', html.length);"`
Expected: imprime "template OK, longitud <n>" (no truena). Nota: es normal que queden `{{OTROS}}` no provistos en esta prueba manual; la validación real es que carga y reemplaza.

- [ ] **Step 5: `npm test`** sigue 148/148 (no toca backend probado). Inspección working tree (sin commitear).

---

### Task 4: Persistir `retry` (flaky) + rutas del reporte en el store

**Files:**
- Modify: `main/playwright/run-tests.js` (mapa `details`)
- Modify: `main/results/store.js` (helpers de ruta)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `record.tests[].retry` (número); `resultsStore.reportHtml(projectId, runId)` y `reportPdf(projectId, runId)` (rutas absolutas en el run dir).

- [ ] **Step 1: Persistir `retry` en `run-tests.js`**

En `main/playwright/run-tests.js`, en el `feed`/`createStreamParser`, el bloque que hace `details.set(...)` es:

```js
      details.set(record.id, {
        id: record.id, name: record.name, status: record.status,
        durationMs: record.durationMs, error: record.error,
      });
```

Reemplazarlo por (añade `retry`):

```js
      details.set(record.id, {
        id: record.id, name: record.name, status: record.status,
        durationMs: record.durationMs, error: record.error, retry: record.retry,
      });
```

- [ ] **Step 2: Añadir `reportHtml` y `reportPdf` en `store.js`**

En `main/results/store.js`, junto a las otras funciones de ruta (después de `const reportIndex = ...`), añadir:

```js
  const reportHtml = (projectId, runId) => path.join(runDir(projectId, runId), 'reporte.html');
  const reportPdf = (projectId, runId) => path.join(runDir(projectId, runId), 'reporte.pdf');
```

Y en el objeto devuelto, ampliar la línea de exports de rutas:

```js
    runDir, reportDir, reportIndex,
```

por:

```js
    runDir, reportDir, reportIndex, reportHtml, reportPdf,
```

- [ ] **Step 3: Verificar**

Run: `npm test`
Expected: PASS — 148/148 (el test de `run-tests` valida campos sueltos, no `deepEqual`, así que `retry` extra no lo rompe).

- [ ] **Step 4: Inspección working tree (sin commitear).**

---

### Task 5: Generar el PDF en `results:save` + abrir reportes (IPC + preload)

**Files:**
- Modify: `main/ipc.js` (imports; `results:save`; `results:openReport`; nuevo `results:openPlaywright`)
- Modify: `preload.js` (nuevo `openResultPlaywright`)

**Interfaces:**
- Consumes: `buildReportTokens` (Task 1), `fillTemplate`/`logoHtml` (Task 2), `renderPdf` (Task 3), `resultsStore.reportHtml/reportPdf` (Task 4).
- Produces: `record.report = { kind:'template-pdf', path:'<id>/reporte.pdf' }` (principal) y `record.reportPlaywright = { path:'<id>/report' }` (secundario). IPC `results:openReport` abre el PDF; `results:openPlaywright` abre el HTML de Playwright. Preload `openResultPlaywright`.

- [ ] **Step 1: Importar los módulos de reporte en `ipc.js`**

En `main/ipc.js`, junto a los `require` de `./results/*` (después de `const { notifyN8n } = require('./results/notify-n8n');`), añadir:

```js
const { buildReportTokens } = require('./results/report-data');
const { fillTemplate, logoHtml } = require('./results/report-html');
const { renderPdf } = require('./results/report-pdf');
```

- [ ] **Step 2: Reemplazar el bloque de reporte en `results:save`**

En `main/ipc.js`, dentro de `ipcMain.handle('results:save', ...)`, **reemplazar** este bloque:

```js
    const record = { ...lastRun };
    try {
      const repoPath = await ensureRepoPath(record.projectId);
      const src = path.join(repoPath, 'playwright-report');
      if (fs.existsSync(src)) {
        const dest = resultsStore.reportDir(record.projectId, record.id);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(src, dest, { recursive: true });
        record.report = { kind: 'playwright-html', path: `${record.id}/report` };
      }
    } catch { record.report = null; }
```

por:

```js
    const record = { ...lastRun };
    record.report = null;
    record.reportPlaywright = null;
    // 1) Reporte visual de Playwright (secundario, con traces/screenshots).
    try {
      const repoPath = await ensureRepoPath(record.projectId);
      const src = path.join(repoPath, 'playwright-report');
      if (fs.existsSync(src)) {
        const dest = resultsStore.reportDir(record.projectId, record.id);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(src, dest, { recursive: true });
        record.reportPlaywright = { path: `${record.id}/report` };
      }
    } catch { record.reportPlaywright = null; }
    // 2) Reporte principal: PDF con la plantilla RASI, desde los datos de la corrida.
    try {
      const profileValues = record.profileId ? profileStore.load(record.projectId, record.profileId) : null;
      const template = fs.readFileSync(path.join(__dirname, 'results', 'report-template.html'), 'utf8');
      const html = fillTemplate(template, { ...buildReportTokens(record, profileValues), LOGO: logoHtml() });
      const htmlPath = resultsStore.reportHtml(record.projectId, record.id);
      const pdfPath = resultsStore.reportPdf(record.projectId, record.id);
      fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
      await renderPdf({ html, htmlPath, pdfPath });
      record.report = { kind: 'template-pdf', path: `${record.id}/reporte.pdf` };
    } catch { record.report = null; }
```

(El resto del handler —bloque n8n y `resultsStore.save(record)`— queda igual.)

- [ ] **Step 3: Reemplazar `results:openReport` y añadir `results:openPlaywright`**

En `main/ipc.js`, **reemplazar** el handler actual:

```js
  ipcMain.handle('results:openReport', async (_event, projectId, runId) => {
    const index = resultsStore.reportIndex(projectId, runId);
    if (!fs.existsSync(index)) return { ok: false, error: 'El reporte no está disponible.' };
    const err = await shell.openPath(index);
    return err ? { ok: false, error: err } : { ok: true };
  });
```

por:

```js
  ipcMain.handle('results:openReport', async (_event, projectId, runId) => {
    const pdf = resultsStore.reportPdf(projectId, runId);
    if (!fs.existsSync(pdf)) return { ok: false, error: 'El reporte no está disponible.' };
    const err = await shell.openPath(pdf);
    return err ? { ok: false, error: err } : { ok: true };
  });

  ipcMain.handle('results:openPlaywright', async (_event, projectId, runId) => {
    const index = resultsStore.reportIndex(projectId, runId);
    if (!fs.existsSync(index)) return { ok: false, error: 'El reporte de Playwright no está disponible.' };
    const err = await shell.openPath(index);
    return err ? { ok: false, error: err } : { ok: true };
  });
```

- [ ] **Step 4: Exponer `openResultPlaywright` en `preload.js`**

En `preload.js`, en el bloque `// resultados guardados`, después de la línea `openResultReport: ...`, añadir:

```js
  openResultPlaywright: (projectId, runId) => ipcRenderer.invoke('results:openPlaywright', projectId, runId),
```

- [ ] **Step 5: Verificar**

Run: `npm test`  → 148/148.
Run: `node --check main/ipc.js && node --check preload.js`  → sin salida.
Inspección working tree (sin commitear).

---

### Task 6: Botones de reporte en el detalle (PDF principal + Playwright secundario)

**Files:**
- Modify: `renderer/renderer.js` (`renderResultDetail`)

**Interfaces:**
- Consumes: `api.openResultReport` (PDF, ya existe) y `api.openResultPlaywright` (Task 5); `r.report` y `r.reportPlaywright` del record.
- Produces: en el detalle, botón "Abrir reporte" (PDF) habilitado si `r.report`, y "Reporte de Playwright" habilitado si `r.reportPlaywright`.

- [ ] **Step 1: Reemplazar el botón de reporte en el markup**

En `renderer/renderer.js`, dentro de `renderResultDetail`, **reemplazar** esta línea:

```js
            <button class="btn btn-secondary" id="btn-open-report" ${r.report ? '' : 'disabled'}>Abrir reporte de Playwright</button>
```

por:

```js
            <button class="btn btn-secondary" id="btn-open-report" ${r.report ? '' : 'disabled'}>Abrir reporte</button>
            <button class="btn btn-secondary" id="btn-open-playwright" ${r.reportPlaywright ? '' : 'disabled'}>Reporte de Playwright</button>
```

- [ ] **Step 2: Ajustar el wireup de los botones**

En `renderer/renderer.js`, dentro de `renderResultDetail`, **reemplazar**:

```js
  const rep = document.getElementById('btn-open-report');
  if (r.report) rep.onclick = () => api.openResultReport(state.project, r.id);
```

por:

```js
  const rep = document.getElementById('btn-open-report');
  if (r.report) rep.onclick = () => api.openResultReport(state.project, r.id);
  const repPw = document.getElementById('btn-open-playwright');
  if (r.reportPlaywright) repPw.onclick = () => api.openResultPlaywright(state.project, r.id);
```

- [ ] **Step 3: Verificar**

Run: `node --check renderer/renderer.js`  → sin salida.
Run: `npm test`  → 148/148 (no toca backend).

- [ ] **Step 4: Smoke manual (requiere display; lo hace el usuario con `npm start`)**

1. Coloca el logo en `main/results/assets/rasi-logo.png`.
2. Corre una prueba → "Guardar solo local" → en el detalle, "Abrir reporte" abre el **PDF** con la plantilla RASI, con los datos de *esa* corrida.
3. "Reporte de Playwright" abre el HTML de Playwright (si el repo lo generó).
4. Verifica que un segundo run genera su propio PDF (ya no "el del anterior").

Inspección working tree (sin commitear).

---

## Self-Review

**Cobertura del spec:**
- PDF con plantilla al guardar local → Task 5 (results:save) + Task 3 (plantilla + motor) + Tasks 1-2 (tokens/fill).
- Tokens desde corrida + `.env` (nombre, cargo, perfil, resumen, módulos, detalle, fallos, flaky, acciones, firma) → Task 1.
- `AMBIENTE`/`URL_SERVIDOR`/`VERSION_ERP` en blanco → Task 1 (strings vacíos).
- Flaky (retry) → Task 4 (persistir retry) + Task 1 (isFlaky).
- Motor `printToPDF` sin deps → Task 3.
- Logo bundleado con fallback a texto → Task 2 (logoHtml) + Task 3 (carpeta) + plantilla `{{LOGO}}`.
- PDF principal + Playwright secundario → Task 5 (campos `report`/`reportPlaywright`, IPC) + Task 6 (botones).
- Corrige "reporte del anterior" para el local → el PDF se arma de `record`, no de copiar `playwright-report` (Task 5).
- Testing unit de la lógica pura → Tasks 1-2; smoke manual → Task 6.

**Placeholders:** ninguno; todos los pasos con código concreto y comandos con salida esperada.

**Consistencia de tipos/nombres:** `buildReportTokens(record, profileValues)` produce exactamente los tokens que usa `report-template.html` (+ `{{LOGO}}` inyectado en Task 5). `fillTemplate`/`logoHtml` (Task 2) usados en Task 5. `renderPdf({ html, htmlPath, pdfPath })` (Task 3) llamado igual en Task 5. `resultsStore.reportHtml/reportPdf` (Task 4) usados en Task 5. `results:openReport`(PDF)/`results:openPlaywright` e `api.openResultReport`/`openResultPlaywright` coinciden entre Tasks 5 y 6. `record.report`/`record.reportPlaywright` coinciden entre Task 5 (escritura) y Task 6 (lectura).
