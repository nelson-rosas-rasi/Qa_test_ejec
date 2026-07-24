# Filtro por fecha + Módulo de Grabaciones — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Filtrar las corridas guardadas por una fecha (calendario) en Resultados. (B) Un módulo "Grabaciones" para grabar pruebas con Playwright codegen, gestionarlas como drafts (renombrar/eliminar) y subirlas (commit+push) a una rama elegida.

**Architecture:** Lógica pura testeable (`matchesLocalDate`, `detectBaseUrl`, `draftFileName`, `sanitizeBranch`, `parseHeads`, store de drafts) + módulos delgados de integración (`codegen` spawnea Playwright, `upload` orquesta git en un clon aislado con la cuenta conectada) + IPC/renderer. Las grabaciones se guardan fuera del clon de ejecución (que se borra en cada "Actualizar pruebas") y la subida usa un clon de subida aparte.

**Tech Stack:** Electron 30, Node `node:test`, Playwright codegen, git con `createGitAuth`.

## Global Constraints

- **NO commitear ni subir el trabajo de RunQA.** Working tree only; revisar con snapshots (`diff -u`). (La subida a git del repo de PRUEBAS del QA sí es funcionalidad de la app.)
- `npm test` desde `Qa_test_ejec/electron-app`. Base: **163/163 verde**; ninguna tarea debe romper tests.
- Tests nuevos: `node:test` + `node:assert/strict`, temp dirs, sin dependencias.
- Los drafts se guardan en `userData/grabaciones/<projectId>/`; el clon de subida en `userData/grabaciones-git/<projectId>/`. Nunca escribir en el clon de ejecución.
- Textos en español. Valores dinámicos en HTML escapados.

**Rutas base:** relativas a `Qa_test_ejec/electron-app/`.

---

### Task 1: `results/filter.js` — predicado de fecha (TDD)

**Files:**
- Create: `main/results/filter.js`
- Test: `test/results-filter.test.js`

**Interfaces:**
- Produces: `matchesLocalDate(isoString, dateStr) -> boolean` (fecha local `YYYY-MM-DD`; `dateStr` vacío → `true`).

- [ ] **Step 1: Test que falla**

Create `test/results-filter.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesLocalDate } = require('../main/results/filter');

const iso = '2026-07-14T16:55:00.000Z';
const local = (() => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

test('sin fecha, no filtra', () => {
  assert.equal(matchesLocalDate(iso, ''), true);
  assert.equal(matchesLocalDate(iso, null), true);
});

test('coincide con la fecha local de la corrida', () => {
  assert.equal(matchesLocalDate(iso, local), true);
});

test('no coincide con otra fecha', () => {
  assert.equal(matchesLocalDate(iso, '1999-01-01'), false);
});

test('fecha inválida no coincide', () => {
  assert.equal(matchesLocalDate('no-es-fecha', '2026-07-14'), false);
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npm test` → FAIL (`Cannot find module '../main/results/filter'`).

- [ ] **Step 3: Implementar**

Create `main/results/filter.js`:

```js
/** ¿La corrida (`isoString`) cae en la fecha local `dateStr` (YYYY-MM-DD)? Vacío = sí. */
function matchesLocalDate(isoString, dateStr) {
  if (!dateStr) return true;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return false;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` === dateStr;
}

module.exports = { matchesLocalDate };
```

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npm test` → PASS (nuevos verdes + 163 previos).

- [ ] **Step 5:** Inspección working tree (sin commitear).

---

### Task 2: Filtro de fecha en el Registro (renderer)

**Files:**
- Modify: `renderer/renderer.js` (`filteredResults`, `renderResultsRegistry`)

**Interfaces:**
- Consumes: `matchesLocalDate` (Task 1) — se replica inline en el renderer (comparación corta).
- Produces: `state.resultsFilter.date`; input de fecha en la fila de filtros.

- [ ] **Step 1: Extender `filteredResults`**

En `renderer/renderer.js`, **reemplazar** la función `filteredResults`:

```js
function filteredResults(f) {
  return state.results.filter((r) => {
    if (f.result === 'passed' && r.summary.failed > 0) return false;
    if (f.result === 'failed' && r.summary.failed === 0) return false;
    if (f.mode !== 'all' && r.mode !== f.mode) return false;
    if (f.query && !(r.tests || []).some((t) => t.name.toLowerCase().includes(f.query.toLowerCase()))) return false;
    return true;
  });
}
```

por:

```js
function filteredResults(f) {
  return state.results.filter((r) => {
    if (f.result === 'passed' && r.summary.failed > 0) return false;
    if (f.result === 'failed' && r.summary.failed === 0) return false;
    if (f.mode !== 'all' && r.mode !== f.mode) return false;
    if (f.query && !(r.tests || []).some((t) => t.name.toLowerCase().includes(f.query.toLowerCase()))) return false;
    if (f.date) {
      const d = new Date(r.finishedAt);
      const p = (n) => String(n).padStart(2, '0');
      const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      if (local !== f.date) return false;
    }
    return true;
  });
}
```

- [ ] **Step 2: Añadir el input de fecha en `renderResultsRegistry`**

En `renderer/renderer.js`, en `renderResultsRegistry`, **reemplazar** la línea del default del filtro:

```js
  const f = state.resultsFilter || (state.resultsFilter = { result: 'all', mode: 'all', query: '' });
```

por:

```js
  const f = state.resultsFilter || (state.resultsFilter = { result: 'all', mode: 'all', query: '', date: '' });
  if (f.date == null) f.date = '';
```

Luego, **reemplazar** el bloque del buscador:

```js
          <div class="search-box"><input id="results-search" placeholder="Buscar test…" value="${escapeHtml(f.query)}"></div>
```

por (añade el selector de fecha con ×):

```js
          <div style="display:flex;align-items:center;gap:6px;">
            <input id="results-date" type="date" value="${escapeHtml(f.date)}" style="padding:8px 10px;border:1px solid #dbe3ef;border-radius:8px;">
            ${f.date ? `<button class="filter-tab" id="results-date-clear" title="Quitar fecha">✕</button>` : ''}
          </div>
          <div class="search-box"><input id="results-search" placeholder="Buscar test…" value="${escapeHtml(f.query)}"></div>
```

- [ ] **Step 3: Cablear el input de fecha**

En `renderer/renderer.js`, al final de `renderResultsRegistry` (después de la línea de `results-search`), añadir:

```js
  document.getElementById('results-date').onchange = (e) => { f.date = e.target.value; renderResults(); };
  const dateClear = document.getElementById('results-date-clear');
  if (dateClear) dateClear.onclick = () => { f.date = ''; renderResults(); };
```

- [ ] **Step 4: Verificar**

Run: `node --check renderer/renderer.js` → sin salida.
Run: `npm test` → 163+/163+ (no toca backend probado).
Smoke manual (usuario): Resultados → Registro, elegir una fecha filtra las corridas de ese día; la × limpia.

---

### Task 3: `recordings/detect.js` — helpers puros (TDD)

**Files:**
- Create: `main/recordings/detect.js`
- Test: `test/recordings-detect.test.js`

**Interfaces:**
- Produces: `detectBaseUrl(values) -> string` (primera URL http(s) del `.env`, prefiriendo claves con URL/BASE/HOST/SERVER); `draftFileName(name) -> '<slug>.spec.ts'`; `sanitizeBranch(name) -> string` (normaliza; '' si inválido).

- [ ] **Step 1: Test que falla**

Create `test/recordings-detect.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectBaseUrl, draftFileName, sanitizeBranch } = require('../main/recordings/detect');

test('detectBaseUrl prefiere una clave con URL/BASE', () => {
  assert.equal(detectBaseUrl({ QA_NOMBRE: 'Ana', BASE_URL: 'https://app.test/', OTRO: 'x' }), 'https://app.test/');
});

test('detectBaseUrl cae a cualquier valor http si no hay clave preferida', () => {
  assert.equal(detectBaseUrl({ FOO: 'http://x.test' }), 'http://x.test');
});

test('detectBaseUrl vacío cuando no hay URL', () => {
  assert.equal(detectBaseUrl({ QA_NOMBRE: 'Ana' }), '');
  assert.equal(detectBaseUrl(null), '');
});

test('draftFileName hace slug y agrega .spec.ts', () => {
  assert.equal(draftFileName('Flujo de Atención'), 'flujo-de-atencion.spec.ts');
  assert.equal(draftFileName(''), 'grabacion.spec.ts');
});

test('sanitizeBranch normaliza espacios y quita caracteres inválidos', () => {
  assert.equal(sanitizeBranch('  draft nueva rama '), 'draft-nueva-rama');
  assert.equal(sanitizeBranch('feat/login~x'), 'feat/loginx');
  assert.equal(sanitizeBranch('   '), '');
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npm test` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

Create `main/recordings/detect.js`:

```js
function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/** Primera URL http(s) del `.env`, prefiriendo claves con URL/BASE/HOST/SERVER. */
function detectBaseUrl(values) {
  if (!values || typeof values !== 'object') return '';
  const entries = Object.entries(values).map(([k, v]) => [k, String(v ?? '').trim()]);
  const isUrl = (v) => /^https?:\/\//i.test(v);
  const preferred = entries.find(([k, v]) => isUrl(v) && /url|base|host|server/i.test(k));
  if (preferred) return preferred[1];
  const any = entries.find(([, v]) => isUrl(v));
  return any ? any[1] : '';
}

/** Nombre de archivo del draft: `<slug>.spec.ts`. */
function draftFileName(name) {
  return (slugify(name) || 'grabacion') + '.spec.ts';
}

/** Normaliza un nombre de rama de git; '' si queda inválido. */
function sanitizeBranch(name) {
  const s = String(name || '').trim()
    .replace(/\s+/g, '-')
    .replace(/[~^:?*[\\]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^[/.]+|[/.]+$/g, '');
  return s;
}

module.exports = { detectBaseUrl, draftFileName, sanitizeBranch, slugify };
```

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npm test` → PASS.

- [ ] **Step 5:** Inspección working tree (sin commitear).

---

### Task 4: `recordings/store.js` — drafts en disco (TDD)

**Files:**
- Create: `main/recordings/store.js`
- Test: `test/recordings-store.test.js`

**Interfaces:**
- Produces: `createRecordingsStore({ dir }) -> { specFile(projectId,id), list(projectId), saveMeta(projectId,id,name), rename(projectId,id,name), markUploaded(projectId,id,branch), remove(projectId,id) }`. Draft = `<id>.spec.ts` + `<id>.json` (meta `{ id, name, createdAt, uploaded }`).

- [ ] **Step 1: Test que falla**

Create `test/recordings-store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecordingsStore } = require('../main/recordings/store');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-rec-'));

function withSpec(store, projectId, id, name) {
  fs.mkdirSync(path.dirname(store.specFile(projectId, id)), { recursive: true });
  fs.writeFileSync(store.specFile(projectId, id), '// test');
  return store.saveMeta(projectId, id, name);
}

test('guarda meta y la lista', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  withSpec(store, 'erp', 'grab-1', 'Uno');
  const list = store.list('erp');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Uno');
  assert.equal(list[0].uploaded, null);
});

test('renombra', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  withSpec(store, 'erp', 'grab-1', 'Uno');
  store.rename('erp', 'grab-1', 'Dos');
  assert.equal(store.list('erp')[0].name, 'Dos');
});

test('marca subido', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  withSpec(store, 'erp', 'grab-1', 'Uno');
  const m = store.markUploaded('erp', 'grab-1', 'drafts/uno');
  assert.equal(m.uploaded.branch, 'drafts/uno');
});

test('elimina spec y meta', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  withSpec(store, 'erp', 'grab-1', 'Uno');
  store.remove('erp', 'grab-1');
  assert.equal(store.list('erp').length, 0);
  assert.equal(fs.existsSync(store.specFile('erp', 'grab-1')), false);
});

test('list vacío sin carpeta', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  assert.deepEqual(store.list('nada'), []);
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npm test` → FAIL.

- [ ] **Step 3: Implementar**

Create `main/recordings/store.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

/** Drafts de grabaciones: `<dir>/<projectId>/<id>.spec.ts` + `<id>.json` (meta). */
function createRecordingsStore({ dir }) {
  const projectDir = (projectId) => path.join(dir, projectId);
  const specFile = (projectId, id) => path.join(projectDir(projectId), `${id}.spec.ts`);
  const metaFile = (projectId, id) => path.join(projectDir(projectId), `${id}.json`);

  function readMeta(projectId, id) {
    try { return JSON.parse(fs.readFileSync(metaFile(projectId, id), 'utf8')); } catch { return null; }
  }
  function writeMeta(projectId, id, meta) {
    fs.mkdirSync(projectDir(projectId), { recursive: true });
    fs.writeFileSync(metaFile(projectId, id), JSON.stringify(meta, null, 2), 'utf8');
    return meta;
  }

  return {
    specFile,
    list(projectId) {
      let names;
      try { names = fs.readdirSync(projectDir(projectId)); } catch { return []; }
      return names.filter((n) => n.endsWith('.json'))
        .map((n) => readMeta(projectId, n.slice(0, -'.json'.length)))
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    saveMeta(projectId, id, name) {
      return writeMeta(projectId, id, { id, name, createdAt: new Date().toISOString(), uploaded: null });
    },
    rename(projectId, id, name) {
      const meta = readMeta(projectId, id);
      if (!meta) return null;
      meta.name = name;
      return writeMeta(projectId, id, meta);
    },
    markUploaded(projectId, id, branch) {
      const meta = readMeta(projectId, id);
      if (!meta) return null;
      meta.uploaded = { branch, at: new Date().toISOString() };
      return writeMeta(projectId, id, meta);
    },
    remove(projectId, id) {
      fs.rmSync(specFile(projectId, id), { force: true });
      fs.rmSync(metaFile(projectId, id), { force: true });
    },
  };
}

module.exports = { createRecordingsStore };
```

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npm test` → PASS.

- [ ] **Step 5:** Inspección working tree (sin commitear).

---

### Task 5: `recordings/codegen.js` — lanzar Playwright codegen

**Files:**
- Create: `main/recordings/codegen.js`

**Interfaces:**
- Produces: `record({ cliPath, repoPath, url, outFile, nodePath? }) -> Promise<{ ok, code?, error? }>` (spawnea codegen; resuelve al cerrar el grabador; el test queda en `outFile`).

- [ ] **Step 1: Implementar**

Create `main/recordings/codegen.js`:

```js
const { spawn } = require('node:child_process');

/**
 * Lanza Playwright codegen con el CLI del repo (para tener navegadores), cwd en el
 * repo, y escribe el test generado en `outFile`. Resuelve cuando el usuario cierra
 * el grabador. Necesita display (abre un navegador): se prueba con smoke manual.
 */
function record({ cliPath, repoPath, url, outFile, nodePath = process.execPath }) {
  return new Promise((resolve) => {
    const args = [cliPath, 'codegen', '--target', 'playwright-test', '--output', outFile];
    if (url) args.push(url);
    const child = spawn(nodePath, args, {
      cwd: repoPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('close', (code) => resolve({ ok: code === 0, code }));
    child.on('error', (err) => resolve({ ok: false, error: err.message || String(err) }));
  });
}

module.exports = { record };
```

- [ ] **Step 2: Verificar**

Run: `node --check main/recordings/codegen.js` → sin salida.
Run: `npm test` → sin cambios (163+ verde).
(La ejecución real de codegen la prueba el usuario con `npm start`; requiere display.)

- [ ] **Step 3:** Inspección working tree (sin commitear).

---

### Task 6: `recordings/upload.js` — subir a git en clon aislado

**Files:**
- Create: `main/recordings/upload.js`
- Test: `test/recordings-upload.test.js` (solo `parseHeads`, que es puro)

**Interfaces:**
- Consumes: `createGitAuth` (se inyecta como `auth`).
- Produces: `createRecordingsUploader({ baseDir, gitPath?, run?, auth? }) -> { listBranches(project), upload({ project, draftPath, repoRelPath, branch, isNew, message, identity }), uploadDir(projectId) }`; export `parseHeads(output) -> string[]`.

- [ ] **Step 1: Test que falla (parseHeads)**

Create `test/recordings-upload.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHeads } = require('../main/recordings/upload');

test('parseHeads extrae y ordena las ramas de ls-remote', () => {
  const out = [
    'abc123\trefs/heads/main',
    'def456\trefs/heads/feature/login',
    'ghi789\trefs/heads/develop',
  ].join('\n');
  assert.deepEqual(parseHeads(out), ['develop', 'feature/login', 'main']);
});

test('parseHeads con salida vacía', () => {
  assert.deepEqual(parseHeads(''), []);
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npm test` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

Create `main/recordings/upload.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
      else resolve({ stdout, stderr });
    });
  });
}

const NO_AUTH = { args: () => [], env: () => ({}) };

/** Ramas de un `git ls-remote --heads`, ordenadas. */
function parseHeads(output) {
  return String(output).split(/\r?\n/)
    .map((l) => l.match(/refs\/heads\/(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Sube drafts al repo de pruebas del QA en un clon aislado (no toca el clon de
 * ejecución). El token viaja por entorno vía `auth` (createGitAuth).
 */
function createRecordingsUploader({ baseDir, gitPath = 'git', run = runFile, auth = NO_AUTH }) {
  const uploadDir = (projectId) => path.join(baseDir, projectId);
  const git = (args, cwd) => run(gitPath, [...auth.args(), ...args], {
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, ...auth.env() },
  });

  async function listBranches(project) {
    const { stdout } = await git(['ls-remote', '--heads', project.repoUrl]);
    return parseHeads(stdout);
  }

  async function ensureClone(project) {
    const dir = uploadDir(project.id);
    if (!fs.existsSync(path.join(dir, '.git'))) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      await git(['clone', project.repoUrl, dir]);
    } else {
      await git(['remote', 'set-url', 'origin', project.repoUrl], dir);
    }
    await git(['fetch', '--prune', 'origin'], dir);
    return dir;
  }

  async function upload({ project, draftPath, repoRelPath, branch, isNew, message, identity }) {
    const dir = await ensureClone(project);
    const base = isNew ? `origin/${project.defaultBranch}` : `origin/${branch}`;
    await git(['checkout', '-B', branch, base], dir);
    const dest = path.join(dir, repoRelPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(draftPath, dest);
    await git(['add', '--', repoRelPath], dir);
    const name = (identity && (identity.name || identity.login)) || 'RunQA';
    const email = (identity && identity.email) || `${(identity && identity.login) || 'runqa'}@users.noreply.github.com`;
    await git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-m', message], dir);
    await git(['push', '-u', 'origin', branch], dir);
    return { ok: true, branch };
  }

  return { listBranches, upload, uploadDir };
}

module.exports = { createRecordingsUploader, parseHeads };
```

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npm test` → PASS (parseHeads verde).
Run: `node --check main/recordings/upload.js` → sin salida.
(El flujo real de git —clonar, push— lo prueba el usuario con `npm start` + una cuenta conectada.)

- [ ] **Step 5:** Inspección working tree (sin commitear).

---

### Task 7: IPC + preload de grabaciones

**Files:**
- Modify: `main/ipc.js` (requires; stores; handlers `recordings:*`)
- Modify: `preload.js`

**Interfaces:**
- Consumes: Tasks 3-6; `store`, `profileStore`, `account`, `ensureProject`, `ensureRepoPath`, `locatePlaywrightCli`, `auth` (ya existen en `registerIpc`).
- Produces IPC: `recordings:list`, `recordings:baseUrl`, `recordings:record`, `recordings:rename`, `recordings:remove`, `recordings:branches`, `recordings:upload`; preload `listRecordings`, `recordingBaseUrl`, `recordFlow`, `renameRecording`, `removeRecording`, `recordingBranches`, `uploadRecording`.

- [ ] **Step 1: Requires en `ipc.js`**

En `main/ipc.js`, junto a los `require` de `./results/*`, añadir:

```js
const { createRecordingsStore } = require('./recordings/store');
const { detectBaseUrl, draftFileName, sanitizeBranch } = require('./recordings/detect');
const { record } = require('./recordings/codegen');
const { createRecordingsUploader } = require('./recordings/upload');
```

- [ ] **Step 2: Instanciar los stores**

En `main/ipc.js`, dentro de `registerIpc`, junto a `const resultsStore = ...`, añadir:

```js
  const recordingsStore = createRecordingsStore({ dir: path.join(userData, 'grabaciones') });
  const uploader = createRecordingsUploader({ baseDir: path.join(userData, 'grabaciones-git'), auth });
```

- [ ] **Step 3: Añadir los handlers**

En `main/ipc.js`, después de la sección `/* ---------- resultados guardados ---------- */` (tras el último handler `results:*`) y antes de `/* ---------- cuenta de GitHub ---------- */` o donde encaje, añadir:

```js
  /* ---------- grabaciones ---------- */
  ipcMain.handle('recordings:list', (_event, projectId) => recordingsStore.list(projectId));

  ipcMain.handle('recordings:baseUrl', (_event, projectId) => {
    const project = store.getProject(projectId);
    const values = project.profile ? profileStore.load(projectId, project.profile) : null;
    return detectBaseUrl(values);
  });

  ipcMain.handle('recordings:record', async (_event, projectId, opts) => {
    const { url = '', name = '' } = opts || {};
    try {
      const repoPath = await ensureRepoPath(projectId);
      const id = 'grab-' + Date.now();
      const specPath = recordingsStore.specFile(projectId, id);
      fs.mkdirSync(path.dirname(specPath), { recursive: true });
      const res = await record({ cliPath: locatePlaywrightCli(repoPath), repoPath, url: String(url).trim(), outFile: specPath });
      if (!res.ok || !fs.existsSync(specPath)) {
        fs.rmSync(specPath, { force: true });
        return { ok: false, error: 'No se grabó nada. Haz el flujo y cierra el grabador para guardarlo.' };
      }
      const finalName = String(name).trim() || `Grabación ${new Date().toLocaleString('es-CO')}`;
      return { ok: true, recording: recordingsStore.saveMeta(projectId, id, finalName) };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    }
  });

  ipcMain.handle('recordings:rename', (_event, projectId, id, name) => {
    const meta = recordingsStore.rename(projectId, id, String(name || '').trim());
    return meta ? { ok: true, recording: meta } : { ok: false, error: 'No se encontró la grabación.' };
  });

  ipcMain.handle('recordings:remove', (_event, projectId, id) => {
    recordingsStore.remove(projectId, id);
    return { ok: true };
  });

  ipcMain.handle('recordings:branches', async (_event, projectId) => {
    try {
      const project = ensureProject(projectId);
      return { ok: true, branches: await uploader.listBranches(project) };
    } catch (err) {
      return { ok: false, error: (err.stderr && String(err.stderr).trim()) || err.message || String(err), code: err.code };
    }
  });

  ipcMain.handle('recordings:upload', async (_event, projectId, opts) => {
    const { id, branch, isNew = false } = opts || {};
    try {
      const project = ensureProject(projectId);
      if (!account.load()) return { ok: false, code: 'GITHUB_REQUIRED', error: 'Conecta tu cuenta de GitHub para subir la grabación.' };
      const safeBranch = sanitizeBranch(branch);
      if (!safeBranch) return { ok: false, error: 'El nombre de la rama no es válido.' };
      const meta = recordingsStore.list(projectId).find((m) => m.id === id);
      if (!meta) return { ok: false, error: 'No se encontró la grabación.' };
      const draftPath = recordingsStore.specFile(projectId, id);
      const repoRelPath = 'tests/' + draftFileName(meta.name);
      const identity = account.load()?.identity || null;
      await uploader.upload({ project, draftPath, repoRelPath, branch: safeBranch, isNew: !!isNew, message: `Draft: ${meta.name} (grabación RunQA)`, identity });
      return { ok: true, recording: recordingsStore.markUploaded(projectId, id, safeBranch), branch: safeBranch };
    } catch (err) {
      return { ok: false, error: (err.stderr && String(err.stderr).trim()) || err.message || String(err), code: err.code };
    }
  });
```

- [ ] **Step 4: Preload**

En `preload.js`, dentro del objeto `qa`, añadir un bloque nuevo (p. ej. antes de `// resultados guardados`):

```js
  // grabaciones
  listRecordings: (projectId) => ipcRenderer.invoke('recordings:list', projectId),
  recordingBaseUrl: (projectId) => ipcRenderer.invoke('recordings:baseUrl', projectId),
  recordFlow: (projectId, opts) => ipcRenderer.invoke('recordings:record', projectId, opts),
  renameRecording: (projectId, id, name) => ipcRenderer.invoke('recordings:rename', projectId, id, name),
  removeRecording: (projectId, id) => ipcRenderer.invoke('recordings:remove', projectId, id),
  recordingBranches: (projectId) => ipcRenderer.invoke('recordings:branches', projectId),
  uploadRecording: (projectId, opts) => ipcRenderer.invoke('recordings:upload', projectId, opts),
```

- [ ] **Step 5: Verificar**

Run: `npm test` → 163+ verde.
Run: `node --check main/ipc.js && node --check preload.js` → sin salida.
Inspección working tree (sin commitear).

---

### Task 8: Pantalla "Grabaciones" (renderer)

**Files:**
- Modify: `renderer/index.html` (nav)
- Modify: `renderer/renderer.js` (router; `renderRecordings`; stub `api`)
- Modify: `renderer/styles.css` (bloque grabaciones)

**Interfaces:**
- Consumes: `api.recordingBaseUrl/listRecordings/recordFlow/renameRecording/removeRecording/recordingBranches/uploadRecording` (Task 7); `openAlert`/`openConfirm`, `escapeHtml`, `needsGithub`, `state`, `$main`, `$overlay`, `closeModal` (existen).
- Produces: `renderRecordings()`; nav `data-screen="recordings"`.

- [ ] **Step 1: Nav en `index.html`**

En `renderer/index.html`, dentro de `<nav class="nav">`, después del `nav-item` de `config`, añadir:

```html
        <div class="nav-item" data-screen="recordings">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
          <span>Grabaciones</span>
        </div>
```

- [ ] **Step 2: Router en `renderScreen()`**

En `renderer/renderer.js`, junto a las otras ramas de `renderScreen`, después de:

```js
  else if (state.screen === 'config') renderConfig();
```

añadir:

```js
  else if (state.screen === 'recordings') renderRecordings();
```

- [ ] **Step 3: Implementar `renderRecordings()`**

En `renderer/renderer.js`, añadir esta función (p. ej. después de `renderConfig`):

```js
async function renderRecordings() {
  const baseUrl = await api.recordingBaseUrl(state.project);
  const recs = await api.listRecordings(state.project);

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div class="screen-title">Grabaciones</div>
        <div class="screen-subtitle">Graba un flujo con el navegador y súbelo al repositorio como borrador.</div>
      </div>
      <div class="config-body">
        <div class="config-section-title">Nueva grabación</div>
        <div class="card">
          <div class="config-label">URL a grabar</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input id="rec-url" type="text" value="${escapeHtml(baseUrl || '')}" placeholder="https://tu-ambiente/…" style="flex:1;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
            <button class="btn btn-primary btn-sm" id="rec-start">● Grabar</button>
          </div>
          <div class="config-hint">Se abrirá un navegador de grabación. Haz el flujo y cierra la ventana para guardar el borrador.</div>
          <div id="rec-status" class="config-hint" style="color:var(--muted)"></div>
        </div>

        <div class="config-section-title" style="margin-top:26px">Borradores</div>
        <div class="card" id="rec-list"></div>
      </div>
    </div>`;

  const list = document.getElementById('rec-list');
  if (recs.length === 0) {
    list.innerHTML = `<div class="config-hint" style="margin:0">Aún no hay grabaciones. Graba un flujo para empezar.</div>`;
  } else {
    list.innerHTML = '';
    recs.forEach((r) => {
      const date = new Date(r.createdAt).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const row = document.createElement('div');
      row.className = 'config-profile-row';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="config-profile-name">${escapeHtml(r.name)}</div>
          <div class="config-hint" style="margin-top:2px">${date}${r.uploaded ? ` · subido a <b>${escapeHtml(r.uploaded.branch)}</b>` : ''}</div>
        </div>
        <button class="btn btn-secondary btn-sm" data-ren="${escapeHtml(r.id)}">Renombrar</button>
        <button class="btn btn-secondary btn-sm" data-del="${escapeHtml(r.id)}">Eliminar</button>
        <button class="btn btn-primary btn-sm" data-up="${escapeHtml(r.id)}">Subir</button>`;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-ren]').forEach((el) => { el.onclick = () => openRenameRecording(el.dataset.ren, recs.find((r) => r.id === el.dataset.ren)); });
    list.querySelectorAll('[data-del]').forEach((el) => { el.onclick = () => openConfirm({ title: 'Eliminar grabación', message: '¿Eliminar este borrador? No se puede deshacer.', confirmText: 'Eliminar', danger: true, onConfirm: async () => { await api.removeRecording(state.project, el.dataset.del); renderRecordings(); } }); });
    list.querySelectorAll('[data-up]').forEach((el) => { el.onclick = () => openUploadRecording(el.dataset.up); });
  }

  document.getElementById('rec-start').onclick = async () => {
    const url = document.getElementById('rec-url').value.trim();
    const btn = document.getElementById('rec-start');
    const status = document.getElementById('rec-status');
    btn.disabled = true; status.textContent = 'Grabando… (cierra el navegador de grabación para terminar)';
    const res = await api.recordFlow(state.project, { url });
    btn.disabled = false; status.textContent = '';
    if (!res.ok) { openAlert({ title: 'No se pudo grabar', message: res.error || 'Ocurrió un error al grabar.' }); return; }
    renderRecordings();
  };
}

function openRenameRecording(id, rec) {
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:440px"><div class="modal-pad">
    <div class="modal-title">Renombrar grabación</div>
    <input id="ren-name" type="text" value="${escapeHtml(rec ? rec.name : '')}" style="width:100%;margin-top:12px;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
    <div class="modal-actions">
      <button class="btn btn-secondary" id="ren-cancel">Cancelar</button>
      <button class="btn btn-primary" id="ren-ok">Guardar</button>
    </div>
  </div></div>`;
  document.getElementById('ren-cancel').onclick = () => closeModal();
  document.getElementById('ren-ok').onclick = async () => {
    const name = document.getElementById('ren-name').value.trim();
    if (!name) return;
    await api.renameRecording(state.project, id, name);
    closeModal();
    renderRecordings();
  };
}

async function openUploadRecording(id) {
  if (needsGithub()) { openAlert({ title: 'Conecta tu cuenta', message: 'Necesitas conectar tu cuenta de GitHub para subir la grabación.' }); return; }
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:480px"><div class="modal-pad">
    <div class="modal-title">Subir grabación</div>
    <div class="modal-sub" style="margin-top:6px">Elige una rama existente o escribe una nueva. Se subirá como borrador.</div>
    <div id="up-body" style="margin-top:14px"><div class="config-hint" style="margin:0">Cargando ramas…</div></div>
    <div id="up-error" style="display:none;margin-top:10px;color:#b91c1c;font-size:12px"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="up-cancel">Cancelar</button>
      <button class="btn btn-primary" id="up-ok" disabled>Subir</button>
    </div>
  </div></div>`;
  document.getElementById('up-cancel').onclick = () => closeModal();

  const res = await api.recordingBranches(state.project);
  const body = document.getElementById('up-body');
  if (!res.ok) { body.innerHTML = `<div class="config-hint" style="margin:0;color:#b91c1c">${escapeHtml(res.error || 'No se pudieron leer las ramas.')}</div>`; return; }
  const options = res.branches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  body.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="radio" name="up-mode" value="existing" checked> Rama existente</label>
    <select id="up-existing" style="width:100%;margin-top:6px;padding:9px;border:1px solid #dbe3ef;border-radius:8px">${options}</select>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-top:12px"><input type="radio" name="up-mode" value="new"> Rama nueva</label>
    <input id="up-new" type="text" placeholder="drafts/mi-grabacion" disabled style="width:100%;margin-top:6px;padding:9px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">`;
  const okBtn = document.getElementById('up-ok');
  okBtn.disabled = false;
  const mode = () => $overlay.querySelector('input[name="up-mode"]:checked').value;
  $overlay.querySelectorAll('input[name="up-mode"]').forEach((el) => el.onchange = () => {
    document.getElementById('up-existing').disabled = mode() !== 'existing';
    document.getElementById('up-new').disabled = mode() !== 'new';
  });
  okBtn.onclick = async () => {
    const isNew = mode() === 'new';
    const branch = isNew ? document.getElementById('up-new').value.trim() : document.getElementById('up-existing').value;
    const err = document.getElementById('up-error');
    if (!branch) { err.textContent = 'Escribe el nombre de la rama.'; err.style.display = 'block'; return; }
    okBtn.disabled = true; okBtn.textContent = 'Subiendo…';
    const up = await api.uploadRecording(state.project, { id, branch, isNew });
    if (!up.ok) { okBtn.disabled = false; okBtn.textContent = 'Subir'; err.textContent = up.error || 'No se pudo subir.'; err.style.display = 'block'; return; }
    closeModal();
    openAlert({ title: 'Grabación subida', message: `Se subió a la rama «${up.branch}».` });
    renderRecordings();
  };
}
```

- [ ] **Step 4: Stub `api` offline**

En `renderer/renderer.js`, en `createBrowserStub` (el objeto `api` de respaldo), añadir métodos vacíos para no romper el modo sin preload:

```js
    async listRecordings() { return []; }, async recordingBaseUrl() { return ''; },
    async recordFlow() { return { ok: false }; }, async renameRecording() {},
    async removeRecording() {}, async recordingBranches() { return { ok: true, branches: [] }; },
    async uploadRecording() { return { ok: false }; },
```

(Insértalo junto a los otros métodos del stub; el punto exacto no importa mientras quede dentro del objeto devuelto.)

- [ ] **Step 5: CSS**

En `renderer/styles.css`, al final, añadir:

```css
/* ===== Grabaciones ===== */
#rec-list .config-profile-row:first-child { padding-top: 2px; }
#rec-start { white-space: nowrap; }
```

- [ ] **Step 6: Verificar**

Run: `node --check renderer/renderer.js` → sin salida.
Run: `npm test` → 163+ verde.
Smoke manual (usuario, `npm start`, requiere display + cuenta): pantalla Grabaciones → Grabar (se abre codegen) → aparece el borrador → Renombrar/Eliminar → Subir (elige rama nueva) → verificar el push en el remoto.

Inspección working tree (sin commitear).

---

## Self-Review

**Cobertura del spec:**
- Filtro por fecha → Task 1 (`matchesLocalDate`) + Task 2 (UI).
- Grabar con codegen desde URL del `.env` → Task 3 (`detectBaseUrl`) + Task 5 (`codegen.record`) + Task 7 (`recordings:record`/`recordings:baseUrl`) + Task 8 (UI).
- Drafts fuera del clon; renombrar/eliminar; inmutables → Task 4 (store) + Task 7/8.
- Subir a rama existente o nueva, commit+push en clon aislado → Task 6 (`upload`) + Task 7 (`recordings:upload`) + Task 8 (modal).
- Requiere cuenta de GitHub → Task 7 (guard `account.load()`) + Task 8 (`needsGithub`).
- Testeable: `matchesLocalDate`, `detectBaseUrl`/`draftFileName`/`sanitizeBranch`, store, `parseHeads` → Tasks 1,3,4,6. codegen/upload/IPC/UI → smoke manual.

**Placeholders:** ninguno; todos los pasos con código y comandos con salida esperada.

**Consistencia de tipos/nombres:** `matchesLocalDate` (Task 1) — la UI replica la lógica inline (Task 2). `detectBaseUrl/draftFileName/sanitizeBranch` (Task 3) usados en Task 7. `createRecordingsStore` API (Task 4) usada en Task 7. `record({cliPath,repoPath,url,outFile})` (Task 5) llamado igual en Task 7. `createRecordingsUploader.listBranches/upload` (Task 6) usados en Task 7. IPC `recordings:*` y wrappers de preload (Task 7) consumidos por `renderRecordings`/modales (Task 8). `state.resultsFilter.date` coherente entre `filteredResults` y `renderResultsRegistry` (Task 2).
