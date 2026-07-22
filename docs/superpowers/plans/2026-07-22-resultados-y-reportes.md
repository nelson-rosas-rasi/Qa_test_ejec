# Resultados y reportes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir cada corrida de Playwright localmente, dejar que el QA decida al terminar si la descarta / guarda local / guarda y genera documentación (n8n), y rehacer la pantalla Resultados como registro filtrable + detalle + métricas de errores por test.

**Architecture:** Tres módulos puros en `main/results/` (almacén en archivos JSON, agregación de métricas, notificador n8n con `fetch` inyectable), sin dependencias de Electron y testeables con `node --test`. `run-tests.js` acumula el detalle por test; `ipc.js` arma el registro de la última corrida y expone los handlers `results:*`; el renderer pinta la decisión post-corrida y la pantalla Resultados. La pantalla Historial se elimina (queda absorbida).

**Tech Stack:** Electron 30 (Node 20 en el main → `fetch` global), `node:test` + `node:assert/strict`, sin dependencias nuevas. Reporter `html` de Playwright por línea de comandos.

## Global Constraints

- **Sin dependencias nuevas.** Solo módulos `node:*` y APIs de Electron ya en uso.
- **Tests con `node --test`**, estilo existente: `require('node:test')`, `require('node:assert/strict')`, temporales con `fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-...'))`, factorías `createX({ ... })`, descripciones en español.
- **Módulos de `main/results/` sin `require('electron')`** — reciben rutas/valores, para poder probarlos contra un temporal.
- **Copy sin jerga técnica** en texto visible: la acción de n8n se llama **"Guardar y generar documentación"**; nada de "n8n", "webhook", "Word", ".env" en la UI.
- **El renderer no tiene tests automáticos** (los ~99 cubren `main/`): las tareas de renderer terminan en verificación manual + commit, no en un test unitario.
- **`mode` se deriva:** 1 test → `individual`; varios o `runAll` → `conjunto`.
- **Cada commit deja `npm test` en verde** (correr desde `electron-app/`: `npm test`).

## File Structure

**Crear:**
- `electron-app/main/results/store.js` — almacén de corridas (un JSON por corrida + carpeta del reporte) y `deriveMode`.
- `electron-app/main/results/metrics.js` — `testHistory(records, testId)` puro.
- `electron-app/main/results/notify-n8n.js` — `notifyN8n(record, { url, fetchImpl })`.
- `electron-app/test/results-store.test.js`
- `electron-app/test/metrics.test.js`
- `electron-app/test/notify-n8n.test.js`

**Modificar:**
- `electron-app/main/playwright/run-tests.js` — acumular detalle por test; `PLAYWRIGHT_HTML_OPEN=never`.
- `electron-app/test/run-tests.test.js` — asserts del detalle por test.
- `electron-app/main/ipc.js` — reporter `html`, registro de última corrida, handlers `results:*`, resolución de URL n8n, quitar stubs.
- `electron-app/preload.js` — exponer métodos `results*`, quitar `generateReport`/`getHistory`.
- `electron-app/renderer/renderer.js` — panel de decisión post-corrida; reescribir Resultados; quitar Historial y el toggle de reporte; stub del navegador.
- `electron-app/renderer/index.html` — quitar el ítem Historial del sidebar.

> Todas las rutas de comandos asumen el directorio `electron-app/`.

---

### Task 1: Almacén de resultados (`main/results/store.js`)

**Files:**
- Create: `electron-app/main/results/store.js`
- Test: `electron-app/test/results-store.test.js`

**Interfaces:**
- Produces:
  - `createResultsStore({ dir })` → `{ save(record), list(projectId), get(projectId, runId), remove(projectId, runId), reportDir(projectId, runId), reportIndex(projectId, runId), runDir(projectId, runId) }`.
  - `deriveMode(testIds, runAll)` → `'individual' | 'conjunto'`.
  - Un `record` tiene al menos `{ id, projectId, finishedAt, tests }`.

- [ ] **Step 1: Write the failing test**

Create `electron-app/test/results-store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createResultsStore, deriveMode } = require('../main/results/store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-results-'));
}
function sampleRecord(over = {}) {
  return {
    id: 'run-1000', projectId: 'erp', projectName: 'ERP',
    finishedAt: '2026-07-22T10:00:00.000Z',
    summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    tests: [{ id: 'a.spec.ts:1', name: 'a', status: 'passed', durationMs: 10, error: null }],
    ...over,
  };
}

test('deriveMode: 1 test es individual, varios o todos es conjunto', () => {
  assert.equal(deriveMode(['a:1'], false), 'individual');
  assert.equal(deriveMode(['a:1', 'b:2'], false), 'conjunto');
  assert.equal(deriveMode([], true), 'conjunto');
});

test('save y get hacen ida y vuelta', () => {
  const dir = tempDir();
  const store = createResultsStore({ dir });
  store.save(sampleRecord());
  assert.deepEqual(store.get('erp', 'run-1000'), sampleRecord());
});

test('save es idempotente por id (no duplica)', () => {
  const dir = tempDir();
  const store = createResultsStore({ dir });
  store.save(sampleRecord({ summary: { total: 1, passed: 0, failed: 1, skipped: 0 } }));
  store.save(sampleRecord()); // mismo id, distinto contenido
  assert.equal(store.list('erp').length, 1);
  assert.equal(store.get('erp', 'run-1000').summary.passed, 1);
});

test('list ordena por finishedAt desc y omite JSON ilegibles', () => {
  const dir = tempDir();
  const store = createResultsStore({ dir });
  store.save(sampleRecord({ id: 'run-1', finishedAt: '2026-07-20T10:00:00.000Z' }));
  store.save(sampleRecord({ id: 'run-2', finishedAt: '2026-07-22T10:00:00.000Z' }));
  fs.writeFileSync(path.join(dir, 'erp', 'run-3.json'), '{ roto');
  const ids = store.list('erp').map((r) => r.id);
  assert.deepEqual(ids, ['run-2', 'run-1']);
});

test('list de un proyecto sin corridas es vacío', () => {
  assert.deepEqual(createResultsStore({ dir: tempDir() }).list('nada'), []);
});

test('remove borra el JSON y la carpeta del reporte', () => {
  const dir = tempDir();
  const store = createResultsStore({ dir });
  store.save(sampleRecord());
  fs.mkdirSync(store.reportDir('erp', 'run-1000'), { recursive: true });
  fs.writeFileSync(store.reportIndex('erp', 'run-1000'), '<html></html>');
  store.remove('erp', 'run-1000');
  assert.equal(store.get('erp', 'run-1000'), null);
  assert.equal(fs.existsSync(store.runDir('erp', 'run-1000')), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/results-store.test.js`
Expected: FAIL con "Cannot find module '../main/results/store'".

- [ ] **Step 3: Write minimal implementation**

Create `electron-app/main/results/store.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

/** 1 test → individual; varios o "todos" → conjunto. */
function deriveMode(testIds, runAll) {
  if (runAll) return 'conjunto';
  return Array.isArray(testIds) && testIds.length === 1 ? 'individual' : 'conjunto';
}

/**
 * Un archivo JSON por corrida bajo `dir/<proyecto>/<runId>.json`, y la copia del
 * reporte HTML en `dir/<proyecto>/<runId>/report/`. Sin dependencias de Electron.
 */
function createResultsStore({ dir }) {
  const projectDir = (projectId) => path.join(dir, projectId);
  const recordFile = (projectId, runId) => path.join(projectDir(projectId), `${runId}.json`);
  const runDir = (projectId, runId) => path.join(projectDir(projectId), runId);
  const reportDir = (projectId, runId) => path.join(runDir(projectId, runId), 'report');
  const reportIndex = (projectId, runId) => path.join(reportDir(projectId, runId), 'index.html');

  return {
    save(record) {
      fs.mkdirSync(projectDir(record.projectId), { recursive: true });
      fs.writeFileSync(recordFile(record.projectId, record.id), JSON.stringify(record, null, 2), 'utf8');
      return record;
    },
    list(projectId) {
      let names;
      try { names = fs.readdirSync(projectDir(projectId)); }
      catch { return []; }
      return names
        .filter((n) => n.endsWith('.json'))
        .map((n) => {
          try { return JSON.parse(fs.readFileSync(path.join(projectDir(projectId), n), 'utf8')); }
          catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    },
    get(projectId, runId) {
      try { return JSON.parse(fs.readFileSync(recordFile(projectId, runId), 'utf8')); }
      catch { return null; }
    },
    remove(projectId, runId) {
      fs.rmSync(recordFile(projectId, runId), { force: true });
      fs.rmSync(runDir(projectId, runId), { recursive: true, force: true });
    },
    runDir, reportDir, reportIndex,
  };
}

module.exports = { createResultsStore, deriveMode };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/results-store.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add main/results/store.js test/results-store.test.js
git commit -m "feat(results): almacén local de corridas en archivos JSON"
```

---

### Task 2: Métricas por test (`main/results/metrics.js`)

**Files:**
- Create: `electron-app/main/results/metrics.js`
- Test: `electron-app/test/metrics.test.js`

**Interfaces:**
- Consumes: un array de `record` de la Task 1 (usa `record.finishedAt` y `record.tests[]` con `{ id, status, error }`).
- Produces: `testHistory(records, testId)` → `{ runs, failures, failRate, lastFailureAt, timeline, topError }` donde `timeline` es un array de `'pass'|'fail'` (máximo 10, orden cronológico) y `topError` es `{ message, count } | null`.

- [ ] **Step 1: Write the failing test**

Create `electron-app/test/metrics.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { testHistory } = require('../main/results/metrics');

function record(id, finishedAt, testId, status, error = null) {
  return { id, finishedAt, tests: [{ id: testId, name: testId, status, error }] };
}

const TID = 'login.spec.ts:22';
const records = [
  record('r1', '2026-07-18T10:00:00Z', TID, 'passed'),
  record('r2', '2026-07-19T10:00:00Z', TID, 'failed', 'timeout esperando #submit'),
  record('r3', '2026-07-20T10:00:00Z', TID, 'failed', 'timeout esperando #submit'),
  record('r4', '2026-07-21T10:00:00Z', 'otro.spec.ts:1', 'passed'), // no aparece TID
  record('r5', '2026-07-22T10:00:00Z', TID, 'failed', 'elemento no encontrado'),
];

test('cuenta corridas y fallos solo donde aparece el test', () => {
  const h = testHistory(records, TID);
  assert.equal(h.runs, 4);
  assert.equal(h.failures, 3);
  assert.equal(Math.round(h.failRate * 100), 75);
});

test('lastFailureAt es la fecha del último fallo', () => {
  assert.equal(testHistory(records, TID).lastFailureAt, '2026-07-22T10:00:00Z');
});

test('timeline es cronológico, pass/fail, máximo 10', () => {
  assert.deepEqual(testHistory(records, TID).timeline, ['pass', 'fail', 'fail', 'fail']);
});

test('topError es el mensaje más frecuente con su conteo', () => {
  assert.deepEqual(testHistory(records, TID).topError, { message: 'timeout esperando #submit', count: 2 });
});

test('un test sin apariciones da métricas en cero', () => {
  const h = testHistory(records, 'inexistente:1');
  assert.equal(h.runs, 0);
  assert.equal(h.failRate, 0);
  assert.equal(h.lastFailureAt, null);
  assert.equal(h.topError, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/metrics.test.js`
Expected: FAIL con "Cannot find module '../main/results/metrics'".

- [ ] **Step 3: Write minimal implementation**

Create `electron-app/main/results/metrics.js`:

```js
const isFail = (status) => status !== 'passed' && status !== 'skipped';

/**
 * Historial agregado de un test a lo largo de las corridas guardadas.
 * `records` es la lista tal cual la devuelve results/store.list().
 */
function testHistory(records, testId) {
  const appearances = [];
  for (const record of records) {
    const t = (record.tests || []).find((x) => x.id === testId);
    if (!t) continue;
    appearances.push({ finishedAt: record.finishedAt, status: t.status, error: t.error });
  }
  appearances.sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));

  const runs = appearances.length;
  const failures = appearances.filter((a) => isFail(a.status)).length;
  const failRate = runs ? failures / runs : 0;

  const lastFailure = [...appearances].reverse().find((a) => isFail(a.status));
  const lastFailureAt = lastFailure ? lastFailure.finishedAt : null;

  const timeline = appearances.slice(-10).map((a) => (isFail(a.status) ? 'fail' : 'pass'));

  const counts = new Map();
  for (const a of appearances) {
    if (!isFail(a.status) || !a.error) continue;
    counts.set(a.error, (counts.get(a.error) || 0) + 1);
  }
  let topError = null;
  for (const [message, count] of counts) {
    if (!topError || count > topError.count) topError = { message, count };
  }

  return { runs, failures, failRate, lastFailureAt, timeline, topError };
}

module.exports = { testHistory };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/metrics.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add main/results/metrics.js test/metrics.test.js
git commit -m "feat(results): agregación de historial de errores por test"
```

---

### Task 3: Notificador n8n (`main/results/notify-n8n.js`)

**Files:**
- Create: `electron-app/main/results/notify-n8n.js`
- Test: `electron-app/test/notify-n8n.test.js`

**Interfaces:**
- Consumes: un `record` (Task 1) y `{ url, fetchImpl }`.
- Produces: `notifyN8n(record, { url, fetchImpl = fetch })` → `Promise<{ ok, at, error }>`. Nunca lanza.

- [ ] **Step 1: Write the failing test**

Create `electron-app/test/notify-n8n.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { notifyN8n } = require('../main/results/notify-n8n');

const record = { id: 'run-1', projectId: 'erp', summary: { total: 1 } };

test('POST con el registro como cuerpo a la URL dada', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
  const res = await notifyN8n(record, { url: 'https://n8n/webhook', fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, 'https://n8n/webhook');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].opts.body), record);
  assert.ok(res.at);
});

test('respuesta no-ok devuelve ok:false con el status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  const res = await notifyN8n(record, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /500/);
});

test('una excepción de red no se propaga', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const res = await notifyN8n(record, { url: 'https://n8n', fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /ECONNREFUSED/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/notify-n8n.test.js`
Expected: FAIL con "Cannot find module '../main/results/notify-n8n'".

- [ ] **Step 3: Write minimal implementation**

Create `electron-app/main/results/notify-n8n.js`:

```js
/**
 * POST del registro de la corrida al webhook de n8n. No lanza: devuelve el
 * resultado para que el llamador lo selle en record.n8n. `fetchImpl` se inyecta
 * en los tests; en producción usa el `fetch` global del Node del main.
 */
async function notifyN8n(record, { url, fetchImpl = fetch }) {
  const at = new Date().toISOString();
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) return { ok: false, at, error: `El servicio respondió ${res.status}` };
    return { ok: true, at, error: null };
  } catch (err) {
    return { ok: false, at, error: err.message || String(err) };
  }
}

module.exports = { notifyN8n };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/notify-n8n.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add main/results/notify-n8n.js test/notify-n8n.test.js
git commit -m "feat(results): notificador n8n con fetch inyectable"
```

---

### Task 4: `run-tests.js` acumula el detalle por test

**Files:**
- Modify: `electron-app/main/playwright/run-tests.js`
- Test: `electron-app/test/run-tests.test.js` (añadir un test)

**Interfaces:**
- Produces: la promesa de `runTests(...)` resuelve con `{ ok, stopped, summary, tests }`, donde `tests` es `[{ id, name, status, durationMs, error }]` (un elemento por test, tomado del `testEnd` no-reintento).

- [ ] **Step 1: Write the failing test**

Añadir al final de `electron-app/test/run-tests.test.js`:

```js
test('resuelve con el detalle por test', { timeout: 120_000 }, async () => {
  const { promise } = runTests(
    {
      repoPath: SAMPLE_REPO,
      cliPath: locatePlaywrightCli(SAMPLE_REPO),
      reporters: [REPORTER],
      testIds: ['alpha'],
      runAll: false,
    },
    () => {},
  );

  const { tests } = await promise;

  assert.equal(tests.length, 4, 'un elemento por test (2 pasan, 1 falla, 1 se omite)');
  const failed = tests.find((t) => t.status === 'failed');
  assert.ok(failed, 'debe haber un test fallido');
  assert.ok(failed.error && failed.error.includes('falla a propósito'));
  assert.ok(tests.every((t) => typeof t.id === 'string' && typeof t.name === 'string'));
  assert.ok(tests.some((t) => t.status === 'passed'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/run-tests.test.js`
Expected: FAIL — `tests` es `undefined` (aún no se devuelve).

- [ ] **Step 3: Write minimal implementation**

En `electron-app/main/playwright/run-tests.js`:

1. Añadir `PLAYWRIGHT_HTML_OPEN` al env del `spawn` (para que el reporter `html`, que se activa desde `ipc.js`, nunca abra un navegador; inocuo cuando no se usa). Reemplazar el bloque del env (líneas ~39-41):

```js
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_HTML_OPEN: 'never' };
  if (profile) env.QA_PROFILE = profile;
```

2. Acumular el detalle. Junto a `const statuses = new Map();` añadir:

```js
  const details = new Map();
```

3. Dentro del `createStreamParser`, en la rama `testEnd`, guardar el detalle (reemplazar la línea `if (record.type === 'testEnd' && !record.willRetry) statuses.set(record.id, record.status);`):

```js
    if (record.type === 'testEnd' && !record.willRetry) {
      statuses.set(record.id, record.status);
      details.set(record.id, {
        id: record.id, name: record.name, status: record.status,
        durationMs: record.durationMs, error: record.error,
      });
    }
```

4. Incluir `tests` en ambos `resolve(...)` de la promesa. En el `child.on('close', ...)`:

```js
      resolve({
        ok: !stopped,
        stopped,
        summary: {
          passed: values.filter((s) => s === 'passed').length,
          failed: values.filter((s) => s !== 'passed' && s !== 'skipped').length,
          skipped: values.filter((s) => s === 'skipped').length,
          durationMs,
        },
        tests: [...details.values()],
      });
```

Y en el `child.on('error', ...)`:

```js
    child.on('error', () => resolve({ ok: false, stopped, summary: { passed: 0, failed: 0, skipped: 0, durationMs: 0 }, tests: [] }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/run-tests.test.js`
Expected: PASS (todos, incluido el nuevo).

- [ ] **Step 5: Commit**

```bash
git add main/playwright/run-tests.js test/run-tests.test.js
git commit -m "feat(run): acumular el detalle por test y suprimir apertura del reporte html"
```

---

### Task 5: IPC — registro de la corrida y handlers `results:*`

**Files:**
- Modify: `electron-app/main/ipc.js`
- Modify: `electron-app/preload.js`

**Interfaces:**
- Consumes: `createResultsStore`, `deriveMode` (Task 1), `testHistory` (Task 2), `notifyN8n` (Task 3), `runTests` que resuelve con `tests` (Task 4).
- Produces (IPC → preload):
  - `run:start` ahora resuelve `{ ok, stopped, summary, runId }`.
  - `results:save(runId, { toN8n })` → `{ ok, record } | { ok:false, code, error }`.
  - `results:list(projectId)` → `[record]`; `results:get(projectId, runId)` → `record|null`; `results:remove(projectId, runId)` → `{ ok }`.
  - `results:metrics(projectId, testIds)` → `{ [testId]: history }`.
  - `results:resendN8n(projectId, runId)` → `{ ok, n8n } | { ok:false, code, error }`.
  - `results:openReport(projectId, runId)` / `results:openFolder(projectId, runId)` → `{ ok } | { ok:false, error }`.
- preload expone: `saveResults`, `listResults`, `getResult`, `removeResult`, `resultsMetrics`, `resendResultN8n`, `openResultReport`, `openResultFolder`.

> Nota: `ipc.js` no tiene suite de tests automáticos en el repo (los tests cubren los módulos que ya se probaron en Tasks 1-4). Esta tarea se verifica dejando `npm test` en verde y con el smoke manual del Step final. **No se quitan aún** `report:generate` ni `history:list` (el renderer todavía los usa hasta la Task 7); se retiran en la Task 8.

- [ ] **Step 1: Requerir los módulos nuevos**

En `electron-app/main/ipc.js`, junto a los `require` de `./playwright/*` (cerca de la línea 13), añadir:

```js
const { createResultsStore, deriveMode } = require('./results/store');
const { testHistory } = require('./results/metrics');
const { notifyN8n } = require('./results/notify-n8n');
```

- [ ] **Step 2: Activar el reporter `html` y crear el store**

En `reportersFor(repoPath)` (líneas ~27-32), añadir `html` como último reporter:

```js
function reportersFor(repoPath) {
  const reporters = [];
  if (fs.existsSync(path.join(repoPath, 'json-reporter.cjs'))) reporters.push('./json-reporter.cjs');
  reporters.push(reporterPath());
  reporters.push('html');
  return reporters;
}
```

Dentro de `registerIpc`, junto a los otros stores (tras `const profileStore = ...`, línea ~41):

```js
  const resultsStore = createResultsStore({ dir: path.join(userData, 'results') });
```

- [ ] **Step 3: Resolver la URL de n8n**

Dentro de `registerIpc`, junto a los helpers (p. ej. tras `materializeActive`), añadir:

```js
  /** URL de n8n: ajuste de proyecto primero, si no el valor del perfil activo. */
  function resolveN8nUrl(projectId) {
    const project = store.getProject(projectId);
    if (project.n8nWebhookUrl) return project.n8nWebhookUrl;
    const values = project.profile ? profileStore.load(projectId, project.profile) : null;
    return (values && values.N8N_WEBHOOK_URL) || null;
  }
```

- [ ] **Step 4: Capturar la última corrida en `run:start`**

Junto a `let currentRun = null;` (línea ~62) añadir `let lastRun = null;`.

Reemplazar el cuerpo de `ipcMain.handle('run:start', ...)` (líneas ~236-259) por:

```js
  ipcMain.handle('run:start', async (event, payload) => {
    const { projectId = 'erp', testIds = [], runAll = false, visualMode = false, stopOnFail = false } = payload || {};
    const empty = { ok: false, stopped: false, summary: { passed: 0, failed: 0, skipped: 0, durationMs: 0 } };
    const runId = 'run-' + Date.now();
    const startedAt = new Date().toISOString();
    try {
      const repoPath = await ensureRepoPath(projectId);
      materializeActive(projectId);
      currentRun = runTests(
        {
          repoPath,
          cliPath: locatePlaywrightCli(repoPath),
          reporters: reportersFor(repoPath),
          profile: store.getProject(projectId).profile,
          testIds, runAll, visualMode, stopOnFail,
        },
        (ipcEvent) => event.sender.send(ipcEvent.channel, ipcEvent.payload),
      );
      const outcome = await currentRun.promise;
      const project = store.getProject(projectId);
      const values = project.profile ? profileStore.load(projectId, project.profile) : null;
      lastRun = {
        id: runId,
        projectId, projectName: project.name || projectId,
        profileId: project.profile || null,
        profileName: (values && values.QA_NOMBRE) || project.profile || null,
        startedAt, finishedAt: new Date().toISOString(),
        durationMs: outcome.summary.durationMs,
        mode: deriveMode(testIds, runAll),
        runAll,
        options: { visualMode, stopOnFail },
        summary: {
          total: outcome.tests.length,
          passed: outcome.summary.passed,
          failed: outcome.summary.failed,
          skipped: outcome.summary.skipped,
        },
        tests: outcome.tests,
        report: null,
        n8n: { sent: false, at: null, ok: null, error: null },
      };
      return { ...outcome, runId };
    } catch (err) {
      showError(err);
      return empty;
    } finally {
      currentRun = null;
    }
  });
```

- [ ] **Step 5: Handlers `results:*`**

Reemplazar los dos stubs finales (líneas ~279-281: `report:generate` e `history:list`) **dejándolos por ahora** y añadir, justo antes de ellos, el bloque de resultados:

```js
  /* ---------- resultados guardados ---------- */
  ipcMain.handle('results:save', async (_event, runId, opts) => {
    const { toN8n = false } = opts || {};
    if (!lastRun || lastRun.id !== runId) {
      return { ok: false, code: 'RUN_EXPIRED', error: 'Esta corrida ya no está disponible para guardar.' };
    }
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
    if (toN8n) {
      const url = resolveN8nUrl(record.projectId);
      if (!url) return { ok: false, code: 'N8N_NOT_CONFIGURED', error: 'Configura la dirección para generar la documentación.' };
      const res = await notifyN8n(record, { url });
      record.n8n = { sent: true, at: res.at, ok: res.ok, error: res.error };
    }
    resultsStore.save(record);
    return { ok: true, record };
  });

  ipcMain.handle('results:list', (_event, projectId) => resultsStore.list(projectId));
  ipcMain.handle('results:get', (_event, projectId, runId) => resultsStore.get(projectId, runId));
  ipcMain.handle('results:remove', (_event, projectId, runId) => {
    resultsStore.remove(projectId, runId);
    return { ok: true };
  });

  ipcMain.handle('results:metrics', (_event, projectId, testIds) => {
    const records = resultsStore.list(projectId);
    const out = {};
    for (const id of testIds || []) out[id] = testHistory(records, id);
    return out;
  });

  ipcMain.handle('results:resendN8n', async (_event, projectId, runId) => {
    const record = resultsStore.get(projectId, runId);
    if (!record) return { ok: false, code: 'RESULT_NOT_FOUND', error: 'No se encontró la corrida.' };
    const url = resolveN8nUrl(projectId);
    if (!url) return { ok: false, code: 'N8N_NOT_CONFIGURED', error: 'Configura la dirección para generar la documentación.' };
    const res = await notifyN8n(record, { url });
    record.n8n = { sent: true, at: res.at, ok: res.ok, error: res.error };
    resultsStore.save(record);
    return { ok: res.ok, n8n: record.n8n };
  });

  ipcMain.handle('results:openReport', (_event, projectId, runId) => {
    const index = resultsStore.reportIndex(projectId, runId);
    if (!fs.existsSync(index)) return { ok: false, error: 'El reporte no está disponible.' };
    shell.openPath(index);
    return { ok: true };
  });

  ipcMain.handle('results:openFolder', (_event, projectId, runId) => {
    const runDir = resultsStore.runDir(projectId, runId);
    shell.openPath(fs.existsSync(runDir) ? runDir : path.join(userData, 'results', projectId));
    return { ok: true };
  });
```

- [ ] **Step 6: Exponer en preload**

En `electron-app/preload.js`, reemplazar las dos líneas `generateReport`/`getHistory` (líneas ~40-41) por (se dejan `generateReport`/`getHistory` **hasta la Task 8**, así que solo se añaden las nuevas debajo):

```js
  generateReport: (runId) => ipcRenderer.invoke('report:generate', runId),
  getHistory: () => ipcRenderer.invoke('history:list'),

  // resultados guardados
  saveResults: (runId, opts) => ipcRenderer.invoke('results:save', runId, opts),
  listResults: (projectId) => ipcRenderer.invoke('results:list', projectId),
  getResult: (projectId, runId) => ipcRenderer.invoke('results:get', projectId, runId),
  removeResult: (projectId, runId) => ipcRenderer.invoke('results:remove', projectId, runId),
  resultsMetrics: (projectId, testIds) => ipcRenderer.invoke('results:metrics', projectId, testIds),
  resendResultN8n: (projectId, runId) => ipcRenderer.invoke('results:resendN8n', projectId, runId),
  openResultReport: (projectId, runId) => ipcRenderer.invoke('results:openReport', projectId, runId),
  openResultFolder: (projectId, runId) => ipcRenderer.invoke('results:openFolder', projectId, runId),
```

- [ ] **Step 7: Verificar la suite y smoke manual**

Run: `npm test`
Expected: PASS (los ~99 + los nuevos de Tasks 1-4; nada roto).

Smoke manual: `npm start`, correr 1 prueba, confirmar en la consola que no aparece un navegador de reporte abriéndose y que la app no lanza errores. (El panel de decisión aún no existe — llega en la Task 6.)

- [ ] **Step 8: Commit**

```bash
git add main/ipc.js preload.js
git commit -m "feat(results): registro de la última corrida y handlers IPC de resultados"
```

---

### Task 6: Renderer — decisión post-corrida y quitar el toggle de reporte

**Files:**
- Modify: `electron-app/renderer/renderer.js`

**Interfaces:**
- Consumes: `api.startRun(...)` que ahora devuelve `runId`; `api.saveResults(runId, { toN8n })`.
- Produces: `state.pendingSave` y `openResultDetail(runId)` (definido aquí de forma mínima; la Task 7 lo reemplaza por la vista completa). Añade `state.resultsView`, `state.currentRunId` al `state`.

> Renderer sin tests automáticos: verificación manual con la app + con el stub en navegador.

- [ ] **Step 1: Quitar `generateReport` del modal y del estado**

En `state.runOptions` (línea ~29) quitar `generateReport`:

```js
  runOptions: { visualMode: false, stopOnFail: false },
```

En `renderRunOptionsModal` quitar el `optionRow('generateReport', ...)` (líneas ~572-574): borrar ese bloque, dejando solo `visualMode` y `stopOnFail`.

Añadir al `state` (junto a `expandedFail: null,`):

```js
  pendingSave: null,       // { runId, summary } tras terminar una corrida
  resultsView: 'registro', // 'registro' | 'detalle' | 'metrics'
  currentRunId: null,
  results: [],             // corridas guardadas del proyecto abierto
  trackedTests: new Set(), // ids de tests seguidos en la pestaña de métricas
```

- [ ] **Step 2: Recoger el `runId` al terminar la corrida**

Reemplazar el cierre de `startRun` (líneas ~845-858, desde `const result = await api.startRun({`) por:

```js
  const result = await api.startRun({
    projectId: state.project,
    testIds: ids,
    runAll: state.runTarget === 'all',
    visualMode: state.runOptions.visualMode,
    stopOnFail: state.runOptions.stopOnFail,
  });
  state.running = false;
  state.pendingSave = result && result.runId ? { runId: result.runId, summary: result.summary } : null;
  if (state.screen === 'live') renderLive();
```

- [ ] **Step 3: Panel de decisión en la pantalla en vivo**

Al **final** de la función `renderLive` (después de la línea que engancha `document.getElementById('btn-stop').onclick`), añadir esta línea. `renderSaveDecision` solo añade un hijo al `.screen` ya renderizado, así que su posición no depende del resto del wiring:

```js
  if (!state.running && state.pendingSave) renderSaveDecision();
```

Y añadir la función nueva (por ejemplo justo debajo de `renderLive`):

```js
function renderSaveDecision() {
  const s = state.pendingSave.summary || { total: 0, passed: 0, failed: 0 };
  const panel = document.createElement('div');
  panel.className = 'report-banner';
  panel.style.marginTop = '16px';
  panel.innerHTML = `
    <div style="flex:1;">
      <div class="report-text-title">La corrida terminó — ${s.passed || 0} de ${s.total || 0} pruebas pasaron</div>
      <div class="report-text-sub" id="save-decision-msg">¿Guardas esta corrida en el registro?</div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" id="dec-discard">Descartar</button>
      <button class="btn btn-secondary" id="dec-local">Guardar solo local</button>
      <button class="btn btn-primary" id="dec-n8n">Guardar y generar documentación</button>
    </div>`;
  document.querySelector('.screen').appendChild(panel);

  const runId = state.pendingSave.runId;
  const msg = () => document.getElementById('save-decision-msg');
  document.getElementById('dec-discard').onclick = () => {
    state.pendingSave = null;
    goToResults('registro');
  };
  document.getElementById('dec-local').onclick = async () => {
    const r = await api.saveResults(runId, { toN8n: false });
    if (!r.ok) { msg().textContent = r.error || 'No se pudo guardar.'; return; }
    state.pendingSave = null;
    openResultDetail(r.record.id);
  };
  document.getElementById('dec-n8n').onclick = async () => {
    const r = await api.saveResults(runId, { toN8n: true });
    if (!r.ok && r.code === 'N8N_NOT_CONFIGURED') {
      msg().textContent = r.error + ' Puedes Guardar solo local por ahora.';
      return;
    }
    if (!r.ok) { msg().textContent = r.error || 'No se pudo guardar.'; return; }
    state.pendingSave = null;
    openResultDetail(r.record.id);
  };
}

/** Va a Resultados en la vista pedida. */
function goToResults(view) {
  state.resultsView = view;
  state.screen = 'results';
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === 'results'));
  renderScreen();
}

/** Abre el detalle de una corrida guardada. */
function openResultDetail(runId) {
  state.currentRunId = runId;
  goToResults('detalle');
}
```

- [ ] **Step 4: Verificación manual**

Run: `npm start`
Verificar: correr una prueba → al terminar aparece el panel con **Descartar / Guardar solo local / Guardar y generar documentación**. "Descartar" lleva a Resultados sin guardar. "Guardar solo local" no lanza errores (la vista de detalle real llega en la Task 7; por ahora puede mostrar la vista vieja o vacía, es aceptable en este commit intermedio).

- [ ] **Step 5: Commit**

```bash
git add renderer/renderer.js
git commit -m "feat(renderer): decisión de guardado tras la corrida (descartar/local/n8n)"
```

---

### Task 7: Renderer — reescribir la pantalla Resultados

**Files:**
- Modify: `electron-app/renderer/renderer.js`

**Interfaces:**
- Consumes: `api.listResults`, `api.getResult`, `api.resultsMetrics`, `api.resendResultN8n`, `api.openResultReport`, `api.openResultFolder`.
- Produces: `renderResults()` reescrita con las tres vistas (registro/detalle/métricas). `loadProject` deja de precargar el historial.

- [ ] **Step 1: Cargar resultados al abrir el proyecto**

En `loadProject` (línea ~98) reemplazar `state.history = await api.getHistory();` por:

```js
  state.results = await api.listResults(projectId);
```

En `pullRepos` y donde haga falta, no se toca. (El registro se refresca al entrar a Resultados; ver Step 2.)

- [ ] **Step 2: Reescribir `renderResults`**

Reemplazar toda la función `renderResults` (líneas ~966-1047) por:

```js
async function renderResults() {
  state.results = await api.listResults(state.project);
  if (state.resultsView === 'detalle' && state.currentRunId) return renderResultDetail();
  if (state.resultsView === 'metrics') return renderResultsMetrics();
  return renderResultsRegistry();
}

function resultsTabs(active) {
  return `
    <div class="filter-tabs" style="margin-bottom:14px;">
      <span class="filter-tab ${active === 'registro' ? 'active' : ''}" data-rview="registro">Registro</span>
      <span class="filter-tab ${active === 'metrics' ? 'active' : ''}" data-rview="metrics">Métricas por test</span>
    </div>`;
}
function wireResultsTabs() {
  document.querySelectorAll('[data-rview]').forEach((el) => {
    el.onclick = () => { state.resultsView = el.dataset.rview; state.currentRunId = null; renderResults(); };
  });
}

function runLabel(r) {
  if (r.mode === 'individual') return r.tests && r.tests[0] ? r.tests[0].name : '1 prueba';
  return `${r.summary.total} pruebas`;
}
function n8nBadge(r) {
  if (r.n8n && r.n8n.sent && r.n8n.ok) return `<span class="badge" style="color:var(--accent);background:var(--accent-light);">documentación ✓</span>`;
  if (r.n8n && r.n8n.sent && !r.n8n.ok) return `<span class="badge" style="color:var(--red-dark);background:var(--red-light);border:1px solid var(--red-border);">reintentar envío</span>`;
  return `<span class="badge" style="color:#64748b;background:#f1f5f9;">solo local</span>`;
}

function renderResultsRegistry() {
  const f = state.resultsFilter || (state.resultsFilter = { result: 'all', mode: 'all', query: '' });
  const rows = state.results.filter((r) => {
    if (f.result === 'passed' && r.summary.failed > 0) return false;
    if (f.result === 'failed' && r.summary.failed === 0) return false;
    if (f.mode !== 'all' && r.mode !== f.mode) return false;
    if (f.query && !(r.tests || []).some((t) => t.name.toLowerCase().includes(f.query.toLowerCase()))) return false;
    return true;
  });

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header"><div class="screen-title">Resultados</div>
        ${resultsTabs('registro')}
        <div class="filters-row">
          <div class="filter-tabs">
            <span class="filter-tab ${f.result==='all'?'active':''}" data-fr="all">Todas</span>
            <span class="filter-tab ${f.result==='passed'?'active':''}" data-fr="passed">Todas pasaron</span>
            <span class="filter-tab ${f.result==='failed'?'active':''}" data-fr="failed">Con fallos</span>
          </div>
          <div class="filter-tabs">
            <span class="filter-tab ${f.mode==='all'?'active':''}" data-fm="all">Todo modo</span>
            <span class="filter-tab ${f.mode==='individual'?'active':''}" data-fm="individual">Individual</span>
            <span class="filter-tab ${f.mode==='conjunto'?'active':''}" data-fm="conjunto">Conjunto</span>
          </div>
          <div class="search-box"><input id="results-search" placeholder="Buscar test…" value="${escapeHtml(f.query)}"></div>
        </div>
      </div>
      <div class="history-body"><div class="history-table" id="results-table"></div></div>
    </div>`;

  const $table = document.getElementById('results-table');
  if (rows.length === 0) {
    $table.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;">Aún no has guardado ninguna corrida.</div>`;
  } else {
    rows.forEach((r) => {
      const d = new Date(r.finishedAt);
      const dateStr = d.toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' }) + ' · ' + d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
      const row = document.createElement('div');
      row.className = 'history-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <span class="history-date">${dateStr}</span>
        <span class="history-user">${escapeHtml(r.profileName || '')}</span>
        <span class="history-count">${r.mode === 'individual' ? 'Individual' : 'Conjunto'} · ${escapeHtml(runLabel(r))}</span>
        <span>${r.summary.failed > 0
          ? `<span class="badge" style="color:var(--red-dark);background:var(--red-light);border:1px solid var(--red-border);">${r.summary.failed} fallida${r.summary.failed===1?'':'s'}</span>`
          : `<span class="badge" style="color:var(--green-dark);background:var(--green-light);border:1px solid var(--green-border);">Todas pasaron</span>`}</span>
        <span style="text-align:right;">${n8nBadge(r)}</span>`;
      row.onclick = () => { state.currentRunId = r.id; state.resultsView = 'detalle'; renderResults(); };
      $table.appendChild(row);
    });
  }

  wireResultsTabs();
  document.querySelectorAll('[data-fr]').forEach((el) => el.onclick = () => { f.result = el.dataset.fr; renderResults(); });
  document.querySelectorAll('[data-fm]').forEach((el) => el.onclick = () => { f.mode = el.dataset.fm; renderResults(); });
  document.getElementById('results-search').oninput = (e) => { f.query = e.target.value; renderResultsRegistry(); };
}
```

- [ ] **Step 3: Vista de detalle de una corrida**

Añadir debajo de `renderResultsRegistry`:

```js
async function renderResultDetail() {
  const r = await api.getResult(state.project, state.currentRunId);
  if (!r) { state.resultsView = 'registro'; return renderResults(); }
  const failed = (r.tests || []).filter((t) => t.status !== 'passed' && t.status !== 'skipped');
  const d = new Date(r.finishedAt);
  const dateStr = d.toLocaleString('es-CO', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const dur = Math.round((r.durationMs || 0) / 1000);

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header" style="padding-bottom:16px;">
        <div class="row">
          <div>
            <div style="font-size:12px;color:var(--accent);cursor:pointer;margin-bottom:6px;" id="back-registro">← Registro</div>
            <div class="screen-title">Resultado — ${r.mode === 'individual' ? 'Individual' : 'Conjunto'}</div>
            <div class="screen-subtitle">${dateStr}${r.profileName ? ` · por ${escapeHtml(r.profileName)}` : ''}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" id="btn-open-folder">Abrir carpeta</button>
            <button class="btn btn-secondary" id="btn-open-report" ${r.report ? '' : 'disabled'}>Abrir reporte de Playwright</button>
            ${r.n8n && r.n8n.sent && r.n8n.ok
              ? `<span class="badge" style="color:var(--accent);background:var(--accent-light);align-self:center;">documentación ✓</span>`
              : `<button class="btn btn-primary" id="btn-resend">Guardar y generar documentación</button>`}
          </div>
        </div>
      </div>
      <div class="results-body">
        <div class="summary-cards">
          <div class="card"><div class="card-label">Total</div><div class="card-value">${r.summary.total}</div></div>
          <div class="card green"><div class="card-label">${checkSvg('#16a34a')}Exitosos</div><div class="card-value">${r.summary.passed}</div></div>
          <div class="card red"><div class="card-label">Fallidos</div><div class="card-value">${r.summary.failed}</div></div>
          <div class="card"><div class="card-label">Duración</div><div class="card-value">${Math.floor(dur/60)}m ${dur%60}s</div></div>
        </div>
        <div class="section-title"><span class="bdot"></span>Pruebas fallidas (${failed.length})</div>
        <div class="fail-list" id="fail-list"></div>
      </div>
    </div>`;

  const $failList = document.getElementById('fail-list');
  if (failed.length === 0) {
    $failList.innerHTML = `<div style="padding:20px;color:#94a3b8;">Ninguna prueba falló en esta corrida.</div>`;
  } else {
    failed.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'fail-item';
      item.innerHTML = `
        <div class="fail-head"><div class="info"><div class="name">${escapeHtml(t.name)}</div>
          <div class="meta">${((t.durationMs||0)/1000).toFixed(1)}s</div></div></div>
        <div class="fail-detail"><div class="box"><div class="msg">${escapeHtml(t.error || 'Sin mensaje de error')}</div></div></div>`;
      $failList.appendChild(item);
    });
  }

  document.getElementById('back-registro').onclick = () => { state.resultsView = 'registro'; state.currentRunId = null; renderResults(); };
  document.getElementById('btn-open-folder').onclick = () => api.openResultFolder(state.project, r.id);
  const rep = document.getElementById('btn-open-report');
  if (r.report) rep.onclick = () => api.openResultReport(state.project, r.id);
  const resend = document.getElementById('btn-resend');
  if (resend) resend.onclick = async () => {
    resend.disabled = true; resend.textContent = 'Generando…';
    const res = await api.resendResultN8n(state.project, r.id);
    if (!res.ok) { resend.disabled = false; resend.textContent = res.error && res.code === 'N8N_NOT_CONFIGURED' ? 'Configura la dirección primero' : 'Reintentar'; return; }
    renderResults();
  };
}
```

- [ ] **Step 4: Vista de métricas por test**

Añadir debajo de `renderResultDetail`:

```js
async function renderResultsMetrics() {
  // Unión de tests vistos en las corridas guardadas (para el selector).
  const seen = new Map();
  state.results.forEach((r) => (r.tests || []).forEach((t) => seen.set(t.id, t.name)));
  const testIds = [...state.trackedTests];
  const metrics = testIds.length ? await api.resultsMetrics(state.project, testIds) : {};

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header"><div class="screen-title">Resultados</div>${resultsTabs('metrics')}</div>
      <div class="results-body">
        <div class="section-title">Elige los tests a seguir</div>
        <div id="track-picker" style="display:flex;flex-direction:column;gap:6px;max-height:26vh;overflow:auto;margin-bottom:18px;"></div>
        <div id="metrics-cards"></div>
      </div>
    </div>`;

  const $picker = document.getElementById('track-picker');
  if (seen.size === 0) {
    $picker.innerHTML = `<div style="color:#94a3b8;padding:10px;">Guarda corridas para ver el historial por test.</div>`;
  } else {
    [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')).forEach(([id, name]) => {
      const on = state.trackedTests.has(id);
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;';
      row.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}> <span>${escapeHtml(name)}</span> <span style="color:#94a3b8;">${escapeHtml(id)}</span>`;
      row.querySelector('input').onchange = (e) => {
        if (e.target.checked) state.trackedTests.add(id); else state.trackedTests.delete(id);
        renderResultsMetrics();
      };
      $picker.appendChild(row);
    });
  }

  const $cards = document.getElementById('metrics-cards');
  if (testIds.length === 0) {
    $cards.innerHTML = `<div style="color:#94a3b8;padding:10px;">Selecciona uno o más tests para ver su historial de errores.</div>`;
  } else {
    testIds.forEach((id) => {
      const h = metrics[id] || { runs: 0, failures: 0, failRate: 0, lastFailureAt: null, timeline: [], topError: null };
      const spark = h.timeline.map((s) => s === 'fail' ? '█' : '▁').join('');
      const last = h.lastFailureAt ? new Date(h.lastFailureAt).toLocaleDateString('es-CO', { day:'numeric', month:'short' }) : '—';
      const card = document.createElement('div');
      card.className = 'report-banner';
      card.style.cssText = 'display:block;margin-bottom:10px;';
      card.innerHTML = `
        <div style="font-weight:600;color:#0f172a;">${escapeHtml(seen.get(id) || id)} <span style="color:#94a3b8;font-weight:400;">${escapeHtml(id)}</span></div>
        <div style="margin-top:6px;font-size:13px;color:#334155;">
          Falló ${h.failures} de ${h.runs} corrida${h.runs===1?'':'s'} (${Math.round(h.failRate*100)}%)
          &nbsp;·&nbsp; <span style="font-family:monospace;letter-spacing:2px;">${spark || '—'}</span>
        </div>
        <div style="margin-top:4px;font-size:12px;color:#64748b;">Último fallo: ${last}${h.topError ? ` · Error más frecuente: ${escapeHtml(h.topError.message)} (${h.topError.count}×)` : ''}</div>`;
      $cards.appendChild(card);
    });
  }

  wireResultsTabs();
}
```

- [ ] **Step 5: Verificación manual**

Run: `npm start`
Verificar: tras guardar una corrida (local o con documentación) caes en el **detalle** con datos reales; "Abrir reporte" abre el HTML de Playwright; "Abrir carpeta" abre la carpeta. En **Registro** aparecen las corridas y los filtros (resultado/modo/búsqueda) funcionan. En **Métricas por test**, seleccionar tests muestra su historial; sin corridas guardadas muestra el estado vacío.

- [ ] **Step 6: Commit**

```bash
git add renderer/renderer.js
git commit -m "feat(renderer): Resultados con registro filtrable, detalle y métricas por test"
```

---

### Task 8: Quitar Historial y limpiar los stubs muertos

**Files:**
- Modify: `electron-app/renderer/index.html`
- Modify: `electron-app/renderer/renderer.js`
- Modify: `electron-app/main/ipc.js`
- Modify: `electron-app/preload.js`

**Interfaces:**
- Consumes: nada nuevo. Elimina el ítem Historial, las funciones `renderHistory`/`renderHistoryTable` y los handlers/métodos `report:generate` + `history:list`.

- [ ] **Step 1: Quitar el ítem Historial del sidebar**

En `electron-app/renderer/index.html`, borrar el bloque `<div class="nav-item" data-screen="history">…</div>` (líneas ~58-61).

- [ ] **Step 2: Quitar el código muerto del renderer**

En `renderer.js`:
- En `renderScreen` (línea ~344) borrar la rama `else if (state.screen === 'history') renderHistory();`.
- Borrar las funciones `renderHistory` y `renderHistoryTable` completas (líneas ~1052-1127).
- Borrar la constante `AVATAR_COLORS` (líneas ~1084-1088) y la **segunda** definición de `initials` (líneas ~1089-1091) si quedó duplicada — conservar la primera (línea ~200).
- En el stub `createBrowserStub`: quitar `generateReport` y `getHistory`; añadir métodos de resultados de ejemplo:

```js
    async saveResults(runId, { toN8n }) {
      return { ok: true, record: { id: runId, projectId: 'demo', projectName: 'Demo', profileName: 'María Gómez',
        finishedAt: new Date().toISOString(), durationMs: 42000, mode: 'conjunto',
        summary: { total: 3, passed: 2, failed: 1, skipped: 0 },
        tests: [{ id: 'a.spec.ts:1', name: 'login', status: 'failed', durationMs: 2100, error: 'timeout' }],
        report: null, n8n: { sent: !!toN8n, ok: !!toN8n, at: null, error: null } } };
    },
    async listResults() {
      return [{ id: 'run-1', projectId: 'demo', projectName: 'Demo', profileName: 'María Gómez',
        finishedAt: '2026-07-22T14:00:00Z', durationMs: 42000, mode: 'conjunto',
        summary: { total: 3, passed: 2, failed: 1, skipped: 0 },
        tests: [{ id: 'a.spec.ts:1', name: 'login', status: 'failed', durationMs: 2100, error: 'timeout' }],
        report: null, n8n: { sent: true, ok: true } }];
    },
    async getResult(_p, runId) { return (await this.listResults())[0]; },
    async removeResult() { return { ok: true }; },
    async resultsMetrics(_p, ids) { const o = {}; ids.forEach((id) => o[id] = { runs: 3, failures: 1, failRate: 0.33, lastFailureAt: '2026-07-22T14:00:00Z', timeline: ['pass','fail','pass'], topError: { message: 'timeout', count: 1 } }); return o; },
    async resendResultN8n() { return { ok: true, n8n: { sent: true, ok: true } }; },
    async openResultReport() {}, async openResultFolder() {},
```

- En `loadProject`, el `state.results = await api.listResults(projectId);` ya quedó de la Task 7. Verificar que no queda ninguna referencia a `api.getHistory()` ni `api.generateReport()` en todo el archivo (`grep`).

- [ ] **Step 3: Quitar los handlers y métodos muertos**

En `electron-app/main/ipc.js` borrar las dos líneas de los stubs:

```js
  ipcMain.handle('report:generate', async (_event, runId) => ({ docPath: `/reportes/Reporte-${runId}.docx` }));
  ipcMain.handle('history:list', async () => require('../mock/history.json'));
```

En `electron-app/preload.js` borrar:

```js
  generateReport: (runId) => ipcRenderer.invoke('report:generate', runId),
  getHistory: () => ipcRenderer.invoke('history:list'),
```

- [ ] **Step 4: Verificar que no quedan referencias**

Run: `grep -rn "generateReport\|getHistory\|renderHistory\|history:list\|report:generate" renderer main preload.js`
Expected: sin coincidencias (salvo, si acaso, en `mock/history.json`, que ya no se usa y puede dejarse).

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verificación manual final**

Run: `npm start`
Verificar: el sidebar ya no muestra **Historial**; el flujo completo funciona (correr → decidir → registro/detalle/métricas); abrir la app y navegar entre proyectos no arroja errores en consola.

- [ ] **Step 6: Commit**

```bash
git add renderer/index.html renderer/renderer.js main/ipc.js preload.js
git commit -m "refactor(renderer): eliminar Historial y los stubs de reporte/historial"
```

---

## Self-Review (completado al escribir el plan)

- **Cobertura del spec:** almacén (T1), captura del reporte HTML + detalle por test (T4/T5), flujo Descartar/Local/n8n (T5/T6), disparo real de n8n + Reenviar (T3/T5/T7), pantalla Resultados registro/detalle/métricas (T7), eliminación de Historial (T8), errores `N8N_NOT_CONFIGURED`/`RUN_EXPIRED`/`report=null` (T5), verificación automática y manual (cada tarea). Cubierto.
- **`mode` derivado:** `deriveMode` probado en T1, usado en T5.
- **Consistencia de tipos:** `record` (mismos campos en store T1, run:start T5, renderer T7); `notifyN8n → { ok, at, error }` sellado como `record.n8n = { sent, at, ok, error }` en T5; `testHistory → { runs, failures, failRate, lastFailureAt, timeline, topError }` consumido en T7.
- **Orden de borrado seguro:** los stubs `report:generate`/`history:list` se conservan hasta que el renderer deja de usarlos (T7) y se eliminan en T8, así cada commit queda funcional.
