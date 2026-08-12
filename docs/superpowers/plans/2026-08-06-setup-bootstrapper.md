# RunQA Setup (bootstrapper de prerequisitos) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `RunQA Setup`, un ejecutable Electron portable que deja un Windows limpio listo para RunQA (git, Node 22 LTS, navegadores de Playwright) y termina instalando la app.

**Architecture:** Proyecto nuevo `setup/`, hermano de `electron-app/`, independiente en versión y publicación. El proceso principal se compone de módulos puros con el ejecutor inyectado (`run`), igual que `electron-app/main/projects.js`; el renderer solo pinta un estado publicado por un único canal IPC `setup:state`. Ningún binario se resuelve por PATH: siempre por ruta absoluta bajo `%ProgramFiles%`.

**Tech Stack:** Electron 30, electron-builder 24 (target `portable`), `node:test` como runner, `fetch` nativo. Sin dependencias nuevas de runtime.

## Global Constraints

- El spec es [2026-08-06-setup-bootstrapper-design.md](../specs/2026-08-06-setup-bootstrapper-design.md).
- **Solo Windows x64.** No hay build de macOS ni Linux para el setup.
- **En `setup/`, nunca resolver un binario por PATH.** Después de instalar git o Node, el PATH nuevo no existe en el proceso del setup: todo se resuelve por ruta absoluta bajo `process.env.ProgramFiles`. En `electron-app` (Task 9) la regla es distinta a propósito: se prueba primero la ruta conocida y **se vuelve al PATH como último recurso**, porque la app también tiene que funcionar en equipos preparados sin RunQA Setup.
- **`setup/prerequisites.json` es la única fuente de verdad** de versiones, URLs y sha256. Ningún otro archivo repite una versión.
- **Sin dependencias nuevas.** El runner es `node --test`, como en `electron-app`.
- **Copy en español neutro, sin jerga técnica** (nunca "PATH", "spawn", "commit", "MSI"), igual que el resto del repo.
- Toda función que toque el sistema recibe su ejecutor/lector inyectado (`run`, `exists`, `fetchImpl`) para poder testearse sin tocar la máquina.
- El setup **versiona aparte** de RunQA: tags `setup-v*.*.*`.
- Al terminar cada tarea, `npm test` debe estar verde en el proyecto tocado. En `electron-app` la línea base es **253/253**.
- Working directory por defecto: `setup/`. Las tareas 9 y 10 trabajan en `electron-app/`.

---

### Task 1: Esqueleto del proyecto y `prerequisites.json`

**Files:**
- Create: `setup/package.json`
- Create: `setup/prerequisites.json`
- Create: `setup/renderer/assets/runqa-icon.ico` (copia)
- Create: `setup/test/prerequisites.test.js`
- Create: `setup/.gitignore`

**Interfaces:**
- Consumes: nada.
- Produces: `setup/prerequisites.json` con la forma `{ git: {version, url, sha256}, node: {version, url, sha256}, playwright: {version} }`. Todas las tareas siguientes lo leen con `require('../prerequisites.json')`.

- [ ] **Step 1: Crear `setup/package.json`**

```json
{
  "name": "runqa-setup",
  "version": "1.0.0",
  "description": "Prepara el equipo para RunQA: git, Node y los navegadores de prueba.",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder --win portable",
    "test": "node --test \"test/*.test.js\""
  },
  "license": "UNLICENSED",
  "devDependencies": {
    "electron": "^30.0.0",
    "electron-builder": "^24.13.3"
  },
  "build": {
    "appId": "com.tuempresa.runqasetup",
    "productName": "RunQA Setup",
    "win": {
      "target": "portable",
      "icon": "renderer/assets/runqa-icon.ico",
      "requestedExecutionLevel": "requireAdministrator"
    },
    "portable": {
      "artifactName": "RunQA Setup ${version}.${ext}"
    },
    "files": [
      "main.js",
      "preload.js",
      "main/**/*",
      "renderer/**/*",
      "prerequisites.json"
    ]
  }
}
```

`requestedExecutionLevel: requireAdministrator` es lo que produce el UAC único al abrir. Sin eso, cada instalador hijo pediría el suyo.

- [ ] **Step 2: Crear `setup/.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 3: Copiar el icono**

Run (desde la raíz del repo):
```bash
mkdir -p setup/renderer/assets && cp electron-app/renderer/assets/runqa-icon.ico setup/renderer/assets/runqa-icon.ico
```
Expected: el archivo existe y pesa ~37 KB.

- [ ] **Step 4: Resolver la versión y el sha256 de Node 22 LTS**

Run:
```bash
curl -s https://nodejs.org/dist/index.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const v=JSON.parse(d).find(r=>r.lts&&r.version.startsWith('v22'));console.log(v.version)})"
```
Anotá el resultado (ej. `v22.21.0`). Después:
```bash
curl -s https://nodejs.org/dist/<version>/SHASUMS256.txt | grep 'x64.msi'
```
Expected: una línea `<sha256>  node-<version>-x64.msi`. Esos dos valores van al JSON del Step 6.

- [ ] **Step 5: Resolver la URL y el sha256 de Git para Windows**

Run:
```bash
gh api repos/git-for-windows/git/releases/latest --jq '.assets[] | select(.name | test("64-bit.exe$")) | "\(.name) \(.browser_download_url)"'
```
Después, para el sha256 (la descarga son ~65 MB, es de una sola vez):
```bash
curl -sL <browser_download_url> -o /tmp/git-installer.exe && sha256sum /tmp/git-installer.exe && rm /tmp/git-installer.exe
```
Expected: el hash en minúsculas.

- [ ] **Step 6: Crear `setup/prerequisites.json` con los valores resueltos**

Reemplazá los cuatro valores entre `<>` por los de los Steps 4 y 5. La versión de Playwright sale de `electron-app/test-fixtures/sample-repo/package.json`, que es la referencia del repo.

```json
{
  "git": {
    "version": "<ej. 2.51.0>",
    "url": "<browser_download_url del Step 5>",
    "sha256": "<sha256 del Step 5>"
  },
  "node": {
    "version": "<ej. 22.21.0, sin la v>",
    "url": "https://nodejs.org/dist/v<version>/node-v<version>-x64.msi",
    "sha256": "<sha256 del Step 4>"
  },
  "playwright": {
    "version": "1.58.2"
  }
}
```

- [ ] **Step 7: Escribir el test de integridad**

Crear `setup/test/prerequisites.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const prerequisites = require('../prerequisites.json');

test('cada prerequisito descargable tiene versión, url https y sha256', () => {
  for (const key of ['git', 'node']) {
    const entry = prerequisites[key];
    assert.match(entry.version, /^\d+\.\d+\.\d+$/, `${key}: versión con formato x.y.z`);
    assert.match(entry.url, /^https:\/\//, `${key}: la url debe ser https`);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, `${key}: sha256 en minúsculas`);
  }
});

test('la versión de Playwright coincide con la del repo de pruebas de referencia', () => {
  const sample = require('../../electron-app/test-fixtures/sample-repo/package.json');
  const expected = sample.devDependencies['@playwright/test'];
  assert.equal(prerequisites.playwright.version, expected);
});

test('la url de Node apunta al instalador de la versión declarada', () => {
  assert.ok(prerequisites.node.url.includes(prerequisites.node.version));
  assert.match(prerequisites.node.url, /x64\.msi$/);
});
```

- [ ] **Step 8: Instalar dependencias y correr el test**

Run: `cd setup && npm install && npm test`
Expected: 3 tests, 3 pass. Si falla el de Playwright, corregí `prerequisites.json` (no el fixture).

- [ ] **Step 9: Commit**

```bash
git add setup/
git commit -m "feat(setup): esqueleto del bootstrapper y prerequisitos fijados"
```

---

### Task 2: Rutas absolutas de los binarios (`paths.js`)

**Files:**
- Create: `setup/main/paths.js`
- Create: `setup/test/paths.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `binaryPaths(env = process.env)` → `{ git, node, npm, npx }`, rutas absolutas (strings).
  - `browsersDir(env = process.env)` → ruta de la caché de navegadores.
  - `markerPath(env = process.env)` → ruta del archivo marcador que escribe el setup.

- [ ] **Step 1: Escribir el test que falla**

Crear `setup/test/paths.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { binaryPaths, browsersDir, markerPath } = require('../main/paths');

const ENV = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local' };

test('resuelve los cuatro binarios bajo Archivos de programa', () => {
  const paths = binaryPaths(ENV);
  assert.equal(paths.git, path.join('C:\\Program Files', 'Git', 'cmd', 'git.exe'));
  assert.equal(paths.node, path.join('C:\\Program Files', 'nodejs', 'node.exe'));
  assert.equal(paths.npm, path.join('C:\\Program Files', 'nodejs', 'npm.cmd'));
  assert.equal(paths.npx, path.join('C:\\Program Files', 'nodejs', 'npx.cmd'));
});

test('la caché de navegadores vive en el perfil del usuario', () => {
  assert.equal(browsersDir(ENV), path.join(ENV.LOCALAPPDATA, 'ms-playwright'));
  assert.equal(markerPath(ENV), path.join(ENV.LOCALAPPDATA, 'ms-playwright', '.runqa-setup.json'));
});

test('sin las variables de Windows usa los valores por defecto', () => {
  const paths = binaryPaths({});
  assert.ok(paths.git.endsWith(path.join('Git', 'cmd', 'git.exe')));
  assert.ok(browsersDir({}).endsWith('ms-playwright'));
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd setup && node --test test/paths.test.js`
Expected: FAIL — `Cannot find module '../main/paths'`.

- [ ] **Step 3: Implementar**

Crear `setup/main/paths.js`:

```js
const path = require('node:path');

/**
 * Tras instalar git o Node, el PATH nuevo no existe en este proceso: Windows
 * sólo lo propaga a procesos creados después. Por eso todo se resuelve por
 * ruta absoluta y nunca por nombre de comando.
 */
const programFiles = (env) => env.ProgramFiles || 'C:\\Program Files';
const localAppData = (env) => env.LOCALAPPDATA || path.join('C:\\Users', 'Default', 'AppData', 'Local');

function binaryPaths(env = process.env) {
  const base = programFiles(env);
  const nodeDir = path.join(base, 'nodejs');
  return {
    git: path.join(base, 'Git', 'cmd', 'git.exe'),
    node: path.join(nodeDir, 'node.exe'),
    npm: path.join(nodeDir, 'npm.cmd'),
    npx: path.join(nodeDir, 'npx.cmd'),
  };
}

function browsersDir(env = process.env) {
  return path.join(localAppData(env), 'ms-playwright');
}

/** Playwright nombra sus carpetas por número de build (chromium-1208), no por
 *  su versión. El setup deja este marcador para saber qué versión dejó. */
function markerPath(env = process.env) {
  return path.join(browsersDir(env), '.runqa-setup.json');
}

module.exports = { binaryPaths, browsersDir, markerPath };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd setup && node --test test/paths.test.js`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add setup/main/paths.js setup/test/paths.test.js
git commit -m "feat(setup): resolver git, Node y la caché de navegadores por ruta absoluta"
```

---

### Task 3: Detección de prerequisitos (`detect.js`)

**Files:**
- Create: `setup/main/detect.js`
- Create: `setup/test/detect.test.js`

**Interfaces:**
- Consumes: `binaryPaths`, `markerPath` de `main/paths.js` (Task 2).
- Produces: `detectPrerequisites({ exists, run, env, playwrightVersion })` → `Promise<{ git, node, npm, browsers }>`, donde cada valor es `{ ok: boolean, version: string|null }`. `exists(ruta)` → boolean. `run(cmd, args)` → `Promise<{stdout}>`. `readMarker` es opcional e inyectable para los tests.

- [ ] **Step 1: Escribir el test que falla**

Crear `setup/test/detect.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPrerequisites } = require('../main/detect');

const ENV = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local' };

const versions = {
  'git.exe': 'git version 2.51.0.windows.1\n',
  'node.exe': 'v22.21.0\n',
  'npm.cmd': '10.9.0\n',
};
const runFake = (cmd) => {
  const key = Object.keys(versions).find((name) => cmd.endsWith(name));
  if (!key) throw new Error(`comando inesperado: ${cmd}`);
  return Promise.resolve({ stdout: versions[key] });
};

test('todo instalado devuelve ok y las versiones limpias', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(state.git, { ok: true, version: '2.51.0' });
  assert.deepEqual(state.node, { ok: true, version: '22.21.0' });
  assert.deepEqual(state.npm, { ok: true, version: '10.9.0' });
  assert.deepEqual(state.browsers, { ok: true, version: '1.58.2' });
});

test('un binario ausente no se ejecuta y queda en falta', async () => {
  const state = await detectPrerequisites({
    exists: (ruta) => !ruta.endsWith('git.exe'),
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(state.git, { ok: false, version: null });
  assert.equal(state.node.ok, true);
});

test('un binario presente pero ilegible cuenta como falta', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: (cmd) => (cmd.endsWith('node.exe') ? Promise.reject(new Error('acceso denegado')) : runFake(cmd)),
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(state.node, { ok: false, version: null });
});

test('navegadores de otra versión cuentan como falta', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => ({ playwrightVersion: '1.49.0' }),
  });
  assert.deepEqual(state.browsers, { ok: false, version: '1.49.0' });
});

test('sin marcador los navegadores cuentan como falta', async () => {
  const state = await detectPrerequisites({
    exists: () => true,
    run: runFake,
    env: ENV,
    playwrightVersion: '1.58.2',
    readMarker: () => null,
  });
  assert.deepEqual(state.browsers, { ok: false, version: null });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd setup && node --test test/detect.test.js`
Expected: FAIL — `Cannot find module '../main/detect'`.

- [ ] **Step 3: Implementar**

Crear `setup/main/detect.js`:

```js
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { binaryPaths, markerPath } = require('./paths');

function runFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout });
    });
  });
}

const defaultMarker = (env) => {
  try { return JSON.parse(fs.readFileSync(markerPath(env), 'utf8')); }
  catch { return null; }
};

/** "git version 2.51.0.windows.1" y "v22.21.0" -> "2.51.0" */
function parseVersion(output) {
  const match = String(output).match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

async function probe({ exists, run, ruta, args }) {
  if (!exists(ruta)) return { ok: false, version: null };
  try {
    const { stdout } = await run(ruta, args);
    const version = parseVersion(stdout);
    return version ? { ok: true, version } : { ok: false, version: null };
  } catch {
    return { ok: false, version: null };
  }
}

async function detectPrerequisites({
  exists = fs.existsSync,
  run = runFile,
  env = process.env,
  playwrightVersion,
  readMarker = () => defaultMarker(env),
} = {}) {
  const paths = binaryPaths(env);
  const [git, node, npm] = await Promise.all([
    probe({ exists, run, ruta: paths.git, args: ['--version'] }),
    probe({ exists, run, ruta: paths.node, args: ['--version'] }),
    probe({ exists, run, ruta: paths.npm, args: ['--version'] }),
  ]);
  const marker = readMarker();
  const instalada = marker?.playwrightVersion || null;
  const browsers = { ok: instalada === playwrightVersion, version: instalada };
  return { git, node, npm, browsers };
}

module.exports = { detectPrerequisites, parseVersion };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd setup && node --test test/detect.test.js`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add setup/main/detect.js setup/test/detect.test.js
git commit -m "feat(setup): detectar git, Node, npm y los navegadores instalados"
```

---

### Task 4: Plan de pasos (`steps.js`)

**Files:**
- Create: `setup/main/steps.js`
- Create: `setup/test/steps.test.js`

**Interfaces:**
- Consumes: el estado que produce `detectPrerequisites` (Task 3).
- Produces: `planSteps(estado)` → array de `{ id, label, status }` con `id` ∈ `'git' | 'node' | 'browsers' | 'runqa'`, `status` ∈ `'pending' | 'done'`. El orden es siempre git → node → browsers → runqa.

- [ ] **Step 1: Escribir el test que falla**

Crear `setup/test/steps.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { planSteps } = require('../main/steps');

const completo = {
  git: { ok: true }, node: { ok: true }, npm: { ok: true }, browsers: { ok: true },
};
const vacio = {
  git: { ok: false }, node: { ok: false }, npm: { ok: false }, browsers: { ok: false },
};

test('en una máquina limpia planifica los cuatro pasos', () => {
  assert.deepEqual(planSteps(vacio).map((s) => s.id), ['git', 'node', 'browsers', 'runqa']);
  assert.ok(planSteps(vacio).every((s) => s.status === 'pending'));
});

test('lo ya instalado queda marcado como hecho, no se repite', () => {
  const pasos = planSteps({ ...vacio, git: { ok: true } });
  assert.equal(pasos.find((s) => s.id === 'git').status, 'done');
  assert.equal(pasos.find((s) => s.id === 'node').status, 'pending');
});

test('Node cuenta como hecho sólo si también está npm', () => {
  const pasos = planSteps({ ...vacio, node: { ok: true }, npm: { ok: false } });
  assert.equal(pasos.find((s) => s.id === 'node').status, 'pending');
});

test('instalar RunQA es siempre el último paso y nunca se salta', () => {
  const pasos = planSteps(completo);
  assert.equal(pasos.at(-1).id, 'runqa');
  assert.equal(pasos.at(-1).status, 'pending');
});

test('cada paso trae un texto para el QA, sin jerga', () => {
  for (const paso of planSteps(vacio)) {
    assert.ok(paso.label.length > 0);
    assert.doesNotMatch(paso.label, /PATH|spawn|MSI|shell/i);
  }
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd setup && node --test test/steps.test.js`
Expected: FAIL — `Cannot find module '../main/steps'`.

- [ ] **Step 3: Implementar**

Crear `setup/main/steps.js`:

```js
const LABELS = {
  git: 'Herramienta para traer los proyectos de prueba',
  node: 'Motor que instala las dependencias de cada proyecto',
  browsers: 'Navegadores con los que se ejecutan las pruebas',
  runqa: 'RunQA',
};

/**
 * RunQA no se salta nunca: aunque el equipo ya tenga todo lo demás, el sentido
 * del setup es terminar con la app instalada.
 */
function planSteps(estado) {
  const hecho = {
    git: Boolean(estado.git?.ok),
    node: Boolean(estado.node?.ok && estado.npm?.ok),
    browsers: Boolean(estado.browsers?.ok),
    runqa: false,
  };
  return ['git', 'node', 'browsers', 'runqa'].map((id) => ({
    id,
    label: LABELS[id],
    status: hecho[id] ? 'done' : 'pending',
  }));
}

module.exports = { planSteps, LABELS };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd setup && node --test test/steps.test.js`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add setup/main/steps.js setup/test/steps.test.js
git commit -m "feat(setup): planificar los pasos saltando lo ya instalado"
```

---

### Task 5: Descarga con progreso y verificación sha256 (`download.js`)

**Files:**
- Create: `setup/main/download.js`
- Create: `setup/test/download.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `downloadTo({ url, dest, sha256, onProgress, fetchImpl })` → `Promise<string>` (la ruta final). Todo error que sale de este módulo lleva `code` y mensaje en español: `DOWNLOAD_CORRUPTED` si el hash no coincide (sin dejar archivo en disco), `DOWNLOAD_FAILED` si la URL es inválida o el servidor no responde, `DOWNLOAD_WRITE_FAILED` si no se puede escribir el archivo. `onProgress(percent)` recibe enteros 0-100 (hoy sólo 100 al terminar: el cuerpo se bufferiza completo antes de poder informar avance).

- [ ] **Step 1: Escribir el test que falla**

Crear `setup/test/download.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadTo } = require('../main/download');

const CONTENIDO = Buffer.from('contenido de prueba');
const HASH = crypto.createHash('sha256').update(CONTENIDO).digest('hex');

const fetchFake = () => Promise.resolve({
  ok: true,
  status: 200,
  headers: new Map([['content-length', String(CONTENIDO.length)]]),
  arrayBuffer: () => Promise.resolve(CONTENIDO),
});

function tempDest(nombre) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runqa-setup-')), nombre);
}

test('descarga, verifica el hash y devuelve la ruta', async () => {
  const dest = tempDest('archivo.bin');
  const progreso = [];
  const ruta = await downloadTo({
    url: 'https://ejemplo/archivo.bin', dest, sha256: HASH,
    onProgress: (p) => progreso.push(p), fetchImpl: fetchFake,
  });
  assert.equal(ruta, dest);
  assert.deepEqual(fs.readFileSync(dest), CONTENIDO);
  assert.equal(progreso.at(-1), 100);
});

test('un hash distinto borra el archivo y avisa que se corrompió', async () => {
  const dest = tempDest('archivo.bin');
  await assert.rejects(
    () => downloadTo({ url: 'https://ejemplo/archivo.bin', dest, sha256: 'a'.repeat(64), fetchImpl: fetchFake }),
    (err) => err.code === 'DOWNLOAD_CORRUPTED',
  );
  assert.equal(fs.existsSync(dest), false);
});

test('una respuesta con error nombra el servidor que falló', async () => {
  const dest = tempDest('archivo.bin');
  const fetchError = () => Promise.resolve({ ok: false, status: 503, headers: new Map() });
  await assert.rejects(
    () => downloadTo({ url: 'https://nodejs.org/dist/x.msi', dest, sha256: HASH, fetchImpl: fetchError }),
    (err) => err.code === 'DOWNLOAD_FAILED' && err.message.includes('nodejs.org'),
  );
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd setup && node --test test/download.test.js`
Expected: FAIL — `Cannot find module '../main/download'`.

- [ ] **Step 3: Implementar**

Crear `setup/main/download.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fallo(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function downloadTo({ url, dest, sha256, onProgress = () => {}, fetchImpl = fetch }) {
  const host = new URL(url).host;
  let respuesta;
  try {
    respuesta = await fetchImpl(url);
  } catch {
    throw fallo('DOWNLOAD_FAILED', `No hubo respuesta de ${host}. Revisá la conexión a internet.`);
  }
  if (!respuesta.ok) {
    throw fallo('DOWNLOAD_FAILED', `${host} respondió con un error (${respuesta.status}).`);
  }

  const datos = Buffer.from(await respuesta.arrayBuffer());
  onProgress(100);

  const hash = crypto.createHash('sha256').update(datos).digest('hex');
  if (hash !== sha256) {
    throw fallo('DOWNLOAD_CORRUPTED', 'La descarga se corrompió. Volvé a intentarlo.');
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, datos);
  return dest;
}

module.exports = { downloadTo };
```

Nota: el archivo se escribe **después** de verificar el hash, así el caso corrupto no deja nada en disco que borrar.

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd setup && node --test test/download.test.js`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add setup/main/download.js setup/test/download.test.js
git commit -m "feat(setup): descargar verificando el sha256 y nombrando el servidor que falla"
```

---

### Task 6: Resolver el instalador de RunQA del último release (`releases.js`)

**Files:**
- Create: `setup/main/releases.js`
- Create: `setup/test/releases.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `latestInstaller({ owner, repo, fetchImpl })` → `Promise<{ name, url, version }>`. Lanza `Error` con `code: 'RELEASE_NOT_FOUND'` si no hay release o no trae un asset `RunQA-Installer-*.exe`.

- [ ] **Step 1: Escribir el test que falla**

Crear `setup/test/releases.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { latestInstaller } = require('../main/releases');

const release = {
  tag_name: 'v1.6.0',
  assets: [
    { name: 'latest.yml', browser_download_url: 'https://ejemplo/latest.yml' },
    { name: 'runqa-1.6.0-x64.nsis.7z', browser_download_url: 'https://ejemplo/paquete.7z' },
    { name: 'RunQA-Installer-1.6.0.exe', browser_download_url: 'https://ejemplo/RunQA-Installer-1.6.0.exe' },
  ],
};
const fetchCon = (cuerpo, ok = true) => () => Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(cuerpo) });

test('elige el instalador entre todos los archivos del release', async () => {
  const info = await latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon(release) });
  assert.equal(info.name, 'RunQA-Installer-1.6.0.exe');
  assert.equal(info.url, 'https://ejemplo/RunQA-Installer-1.6.0.exe');
  assert.equal(info.version, '1.6.0');
});

test('sin instalador entre los archivos avisa que el release está incompleto', async () => {
  const sinExe = { ...release, assets: [release.assets[0]] };
  await assert.rejects(
    () => latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon(sinExe) }),
    (err) => err.code === 'RELEASE_NOT_FOUND',
  );
});

test('si GitHub no responde con un release lo dice claro', async () => {
  await assert.rejects(
    () => latestInstaller({ owner: 'x', repo: 'y', fetchImpl: fetchCon({}, false) }),
    (err) => err.code === 'RELEASE_NOT_FOUND' && err.message.includes('github.com'),
  );
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd setup && node --test test/releases.test.js`
Expected: FAIL — `Cannot find module '../main/releases'`.

- [ ] **Step 3: Implementar**

Crear `setup/main/releases.js`:

```js
const INSTALLER = /^RunQA-Installer-(\d+\.\d+\.\d+)\.exe$/;

function fallo(message) {
  const err = new Error(message);
  err.code = 'RELEASE_NOT_FOUND';
  return err;
}

/**
 * El setup no se rearma con cada versión de RunQA: pregunta por el release más
 * reciente en el momento de instalar.
 */
async function latestInstaller({ owner, repo, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  let respuesta;
  try {
    respuesta = await fetchImpl(url, { headers: { accept: 'application/vnd.github+json' } });
  } catch {
    throw fallo('No hubo respuesta de github.com. Revisá la conexión a internet.');
  }
  if (!respuesta.ok) throw fallo('github.com no devolvió ninguna versión publicada de RunQA.');

  const release = await respuesta.json();
  const asset = (release.assets || []).find((a) => INSTALLER.test(a.name));
  if (!asset) throw fallo('La última versión publicada de RunQA no incluye su instalador.');

  return { name: asset.name, url: asset.browser_download_url, version: asset.name.match(INSTALLER)[1] };
}

module.exports = { latestInstaller };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd setup && node --test test/releases.test.js`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add setup/main/releases.js setup/test/releases.test.js
git commit -m "feat(setup): resolver el instalador del último release de RunQA"
```

---

### Task 7: Los cuatro instaladores (`installers/`)

**Files:**
- Create: `setup/main/installers/index.js`
- Create: `setup/test/installers.test.js`

**Interfaces:**
- Consumes: `binaryPaths`, `browsersDir`, `markerPath` (Task 2), `downloadTo` (Task 5), `latestInstaller` (Task 6), `prerequisites.json` (Task 1).
- Produces: `buildInstallers({ run, download, env, prerequisites, writeMarker })` → `{ git, node, browsers, runqa }`, cada uno una función `async ({ onProgress }) => void`. `run(cmd, args, opts)` → `Promise`.

- [ ] **Step 1: Escribir el test que falla**

Crear `setup/test/installers.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInstallers } = require('../main/installers');

const ENV = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local', TEMP: 'C:\\Temp' };
const PRE = {
  git: { version: '2.51.0', url: 'https://ejemplo/Git-64-bit.exe', sha256: 'a'.repeat(64) },
  node: { version: '22.21.0', url: 'https://ejemplo/node-x64.msi', sha256: 'b'.repeat(64) },
  playwright: { version: '1.58.2' },
};

function harness(extra = {}) {
  const llamadas = [];
  const installers = buildInstallers({
    run: (cmd, args, opts) => { llamadas.push({ cmd, args, opts }); return Promise.resolve({ stdout: '' }); },
    download: ({ url, dest }) => Promise.resolve(dest || `C:\\Temp\\${url.split('/').pop()}`),
    env: ENV,
    prerequisites: PRE,
    writeMarker: () => {},
    latest: () => Promise.resolve({ name: 'RunQA-Installer-1.6.0.exe', url: 'https://ejemplo/RunQA-Installer-1.6.0.exe', version: '1.6.0' }),
    ...extra,
  });
  return { installers, llamadas };
}

test('git se instala en silencio y sin reiniciar', async () => {
  const { installers, llamadas } = harness();
  await installers.git({ onProgress: () => {} });
  assert.deepEqual(llamadas[0].args, ['/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-']);
});

test('Node se instala con el instalador de Windows en modo silencioso', async () => {
  const { installers, llamadas } = harness();
  await installers.node({ onProgress: () => {} });
  assert.equal(llamadas[0].cmd, 'msiexec');
  assert.deepEqual(llamadas[0].args.slice(0, 2), ['/i', 'C:\\Temp\\node-x64.msi']);
  assert.ok(llamadas[0].args.includes('/qn'));
});

test('los navegadores se instalan con la versión fijada y por ruta absoluta', async () => {
  const { installers, llamadas } = harness();
  await installers.browsers({ onProgress: () => {} });
  assert.ok(llamadas[0].cmd.endsWith('npx.cmd'));
  assert.deepEqual(llamadas[0].args, ['--yes', 'playwright@1.58.2', 'install']);
  assert.equal(llamadas[0].opts.shell, true);
});

test('al terminar los navegadores deja el marcador de versión', async () => {
  let marcador = null;
  const { installers } = harness({ writeMarker: (datos) => { marcador = datos; } });
  await installers.browsers({ onProgress: () => {} });
  assert.deepEqual(marcador, { playwrightVersion: '1.58.2' });
});

test('RunQA se descarga del último release y se ejecuta', async () => {
  const { installers, llamadas } = harness();
  await installers.runqa({ onProgress: () => {} });
  assert.ok(llamadas[0].cmd.endsWith('RunQA-Installer-1.6.0.exe'));
  assert.deepEqual(llamadas[0].args, []);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd setup && node --test test/installers.test.js`
Expected: FAIL — `Cannot find module '../main/installers'`.

- [ ] **Step 3: Implementar**

Crear `setup/main/installers/index.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { binaryPaths, browsersDir, markerPath } = require('../paths');
const { downloadTo } = require('../download');
const { latestInstaller } = require('../releases');

const OWNER = 'nelson-rosas-rasi';
const REPO = 'Qa_test_ejec';

function runFile(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
      else resolve({ stdout, stderr });
    });
  });
}

const defaultWriteMarker = (env) => (datos) => {
  fs.mkdirSync(browsersDir(env), { recursive: true });
  fs.writeFileSync(markerPath(env), JSON.stringify(datos, null, 2));
};

function buildInstallers({
  run = runFile,
  download = downloadTo,
  env = process.env,
  prerequisites = require('../../prerequisites.json'),
  writeMarker,
  latest = (opts) => latestInstaller({ owner: OWNER, repo: REPO, ...opts }),
} = {}) {
  const paths = binaryPaths(env);
  const temp = env.TEMP || env.TMP || 'C:\\Windows\\Temp';
  const marcar = writeMarker || defaultWriteMarker(env);
  const destino = (url) => path.join(temp, url.split('/').pop());

  return {
    async git({ onProgress }) {
      const archivo = await download({ url: prerequisites.git.url, dest: destino(prerequisites.git.url), sha256: prerequisites.git.sha256, onProgress });
      // Instalador Inno Setup: silencioso, sin reinicio y sin botón de cancelar.
      await run(archivo, ['/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-']);
    },

    async node({ onProgress }) {
      const archivo = await download({ url: prerequisites.node.url, dest: destino(prerequisites.node.url), sha256: prerequisites.node.sha256, onProgress });
      await run('msiexec', ['/i', archivo, '/qn', '/norestart']);
    },

    async browsers({ onProgress }) {
      onProgress(0);
      // npx es un .cmd y Node >=20.12 se niega a ejecutarlo sin shell. Los
      // argumentos son constantes (salen de prerequisites.json), así que
      // concatenarlos es seguro.
      await run(paths.npx, ['--yes', `playwright@${prerequisites.playwright.version}`, 'install'], { shell: true });
      marcar({ playwrightVersion: prerequisites.playwright.version });
      onProgress(100);
    },

    async runqa({ onProgress }) {
      const info = await latest({});
      const archivo = await download({ url: info.url, dest: path.join(temp, info.name), sha256: null, onProgress, verify: false });
      await run(archivo, []);
    },
  };
}

module.exports = { buildInstallers, OWNER, REPO };
```

- [ ] **Step 4: Permitir la descarga sin hash conocido**

El instalador de RunQA no tiene un sha256 fijo (cambia en cada release), así que `downloadTo` necesita aceptar `verify: false`. En `setup/main/download.js`, reemplazar el bloque del hash por:

```js
  if (verify) {
    const hash = crypto.createHash('sha256').update(datos).digest('hex');
    if (hash !== sha256) {
      throw fallo('DOWNLOAD_CORRUPTED', 'La descarga se corrompió. Volvé a intentarlo.');
    }
  }
```

y agregar `verify = true` a los parámetros de `downloadTo`.

- [ ] **Step 5: Agregar el test de esa opción**

Agregar al final de `setup/test/download.test.js`:

```js
test('con verify en false acepta el archivo sin hash conocido', async () => {
  const dest = tempDest('installer.exe');
  const ruta = await downloadTo({ url: 'https://ejemplo/installer.exe', dest, sha256: null, verify: false, fetchImpl: fetchFake });
  assert.equal(ruta, dest);
});
```

- [ ] **Step 6: Correr los tests**

Run: `cd setup && node --test test/installers.test.js test/download.test.js`
Expected: 5 + 4 pass.

- [ ] **Step 7: Commit**

```bash
git add setup/main/installers/index.js setup/main/download.js setup/test/installers.test.js setup/test/download.test.js
git commit -m "feat(setup): instalar git, Node, navegadores y RunQA en silencio"
```

---

### Task 8: Orquestación, ventana y pantalla

**Files:**
- Create: `setup/main/run.js`
- Create: `setup/main/log.js`
- Create: `setup/main.js`
- Create: `setup/preload.js`
- Create: `setup/renderer/index.html`
- Create: `setup/renderer/setup.js`
- Create: `setup/renderer/styles.css`
- Create: `setup/test/run.test.js`

**Interfaces:**
- Consumes: `detectPrerequisites` (Task 3), `planSteps` (Task 4), `buildInstallers` (Task 7).
- Produces: `createRunner({ detect, installers, publish })` → `{ refresh(), start(), retry(id) }`. `publish(estado)` recibe `{ steps, current, error }`. `detect()` se llama una vez al refrescar y **otra vez después de cada instalación**, para confirmar el paso antes de marcarlo hecho. El preload expone `window.setup` con `refresh`, `start`, `retry`, `onState`, `openLog`.

- [ ] **Step 1: Escribir el test que falla**

Crear `setup/test/run.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunner } = require('../main/run');

const estadoLimpio = { git: { ok: false }, node: { ok: false }, npm: { ok: false }, browsers: { ok: false } };
const estadoCompleto = { git: { ok: true }, node: { ok: true }, npm: { ok: true }, browsers: { ok: true } };

function harness({ falla = null, detectados = [estadoLimpio, estadoCompleto] } = {}) {
  const publicados = [];
  let vuelta = 0;
  const ejecutados = [];
  const runner = createRunner({
    detect: () => Promise.resolve(detectados[Math.min(vuelta++, detectados.length - 1)]),
    installers: {
      git: () => { ejecutados.push('git'); return falla === 'git' ? Promise.reject(new Error('sin permisos')) : Promise.resolve(); },
      node: () => { ejecutados.push('node'); return Promise.resolve(); },
      browsers: () => { ejecutados.push('browsers'); return Promise.resolve(); },
      runqa: () => { ejecutados.push('runqa'); return Promise.resolve(); },
    },
    publish: (estado) => publicados.push(estado),
  });
  return { runner, publicados, ejecutados };
}

test('al refrescar publica el plan sin ejecutar nada', async () => {
  const { runner, publicados, ejecutados } = harness();
  await runner.refresh();
  assert.deepEqual(ejecutados, []);
  assert.deepEqual(publicados.at(-1).steps.map((s) => s.id), ['git', 'node', 'browsers', 'runqa']);
});

test('start ejecuta en orden y termina con RunQA', async () => {
  const { runner, ejecutados } = harness();
  await runner.refresh();
  await runner.start();
  assert.deepEqual(ejecutados, ['git', 'node', 'browsers', 'runqa']);
});

test('un paso que falla detiene la cadena y deja el error visible', async () => {
  const { runner, publicados, ejecutados } = harness({ falla: 'git' });
  await runner.refresh();
  await runner.start();
  assert.deepEqual(ejecutados, ['git']);
  const final = publicados.at(-1);
  assert.equal(final.steps.find((s) => s.id === 'git').status, 'error');
  assert.equal(final.error, 'sin permisos');
});

test('reintentar un paso vuelve a ejecutar sólo ese paso', async () => {
  const { runner, ejecutados } = harness({ falla: 'git' });
  await runner.refresh();
  await runner.start();
  ejecutados.length = 0;
  await runner.retry('git');
  assert.deepEqual(ejecutados, ['git']);
});

test('lo ya instalado no se vuelve a ejecutar', async () => {
  const { runner, ejecutados } = harness({ detectados: [estadoCompleto] });
  await runner.refresh();
  await runner.start();
  assert.deepEqual(ejecutados, ['runqa']);
});

test('si el instalador termina pero el requisito sigue faltando, no sigue de largo', async () => {
  const { runner, publicados, ejecutados } = harness({ detectados: [estadoLimpio] });
  await runner.refresh();
  await runner.start();
  assert.deepEqual(ejecutados, ['git']);
  const paso = publicados.at(-1).steps.find((s) => s.id === 'git');
  assert.equal(paso.status, 'error');
  assert.match(publicados.at(-1).error, /no qued[oó] instalad/i);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd setup && node --test test/run.test.js`
Expected: FAIL — `Cannot find module '../main/run'`.

- [ ] **Step 3: Implementar el orquestador**

Crear `setup/main/run.js`:

```js
const { planSteps, LABELS } = require('./steps');

/** Un paso sólo se da por hecho si la detección lo confirma. `runqa` no se
 *  verifica: lo instala el asistente de NSIS después de que el setup se cierra. */
const CONFIRMA = {
  git: (estado) => estado.git?.ok,
  node: (estado) => estado.node?.ok && estado.npm?.ok,
  browsers: (estado) => estado.browsers?.ok,
  runqa: () => true,
};

/**
 * Un único estado publicado por `publish`, igual que hace el updater de RunQA:
 * el renderer sólo pinta lo que llega y no decide nada.
 */
function createRunner({ detect, installers, publish }) {
  let steps = [];
  let current = null;
  let error = null;

  const emitir = () => publish({ steps: steps.map((s) => ({ ...s })), current, error });

  const marcar = (id, status, percent = 0) => {
    steps = steps.map((s) => (s.id === id ? { ...s, status, percent } : s));
    emitir();
  };

  async function ejecutar(id) {
    current = id;
    error = null;
    marcar(id, 'running');
    try {
      await installers[id]({ onProgress: (percent) => marcar(id, 'running', percent) });
      // Verificar: un instalador puede terminar sin error y no dejar el binario
      // donde corresponde. Se confirma releyendo el sistema, no confiando en el
      // código de salida.
      if (!CONFIRMA[id](await detect())) {
        error = `${LABELS[id]} no quedó instalado. Volvé a intentarlo.`;
        marcar(id, 'error');
        return false;
      }
      marcar(id, 'done', 100);
      return true;
    } catch (err) {
      error = err?.message || String(err);
      marcar(id, 'error');
      return false;
    } finally {
      current = null;
    }
  }

  return {
    async refresh() {
      const estado = await detect();
      steps = planSteps(estado).map((s) => ({ ...s, percent: s.status === 'done' ? 100 : 0 }));
      error = null;
      emitir();
    },

    async start() {
      for (const paso of steps.filter((s) => s.status !== 'done')) {
        const ok = await ejecutar(paso.id);
        if (!ok) return;
      }
    },

    async retry(id) {
      await ejecutar(id);
    },
  };
}

module.exports = { createRunner };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd setup && node --test test/run.test.js`
Expected: 5 pass.

- [ ] **Step 5: Escribir el registro en archivo**

Crear `setup/main/log.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

/** Registro plano para poder pedirle al QA "mandame el archivo" cuando algo falla. */
function createLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'setup.log');
  const write = (linea) => fs.appendFileSync(file, `[${new Date().toISOString()}] ${linea}\n`);
  return { file, write };
}

module.exports = { createLog };
```

- [ ] **Step 6: Escribir el proceso principal**

Crear `setup/main.js`:

```js
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { detectPrerequisites } = require('./main/detect');
const { buildInstallers } = require('./main/installers');
const { createRunner } = require('./main/run');
const { createLog } = require('./main/log');
const prerequisites = require('./prerequisites.json');

let ventana = null;

function crearVentana() {
  ventana = new BrowserWindow({
    width: 620,
    height: 660,
    resizable: false,
    title: 'RunQA Setup',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  ventana.setMenuBarVisibility(false);
  ventana.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  const log = createLog(path.join(app.getPath('appData'), 'RunQA Setup'));
  const installers = buildInstallers({});
  let terminado = false;
  const runner = createRunner({
    detect: () => detectPrerequisites({ playwrightVersion: prerequisites.playwright.version }),
    installers,
    publish: (estado) => {
      if (estado.error) log.write(`error en ${estado.current || 'un paso'}: ${estado.error}`);
      terminado = estado.steps.length > 0 && estado.steps.every((paso) => paso.status === 'done');
      ventana?.webContents.send('setup:state', estado);
    },
  });

  ipcMain.handle('setup:refresh', () => runner.refresh());
  ipcMain.handle('setup:start', async () => {
    await runner.start();
    // El último paso espera a que el asistente de RunQA termine. Si llegó hasta
    // ahí, el setup ya cumplió su función y se va.
    if (terminado) app.quit();
  });
  ipcMain.handle('setup:retry', (_e, id) => runner.retry(id));
  ipcMain.handle('setup:openLog', () => shell.openPath(log.file));

  crearVentana();
});

app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 7: Escribir el puente**

Crear `setup/preload.js`:

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  refresh: () => ipcRenderer.invoke('setup:refresh'),
  start: () => ipcRenderer.invoke('setup:start'),
  retry: (id) => ipcRenderer.invoke('setup:retry', id),
  openLog: () => ipcRenderer.invoke('setup:openLog'),
  onState: (cb) => ipcRenderer.on('setup:state', (_e, estado) => cb(estado)),
});
```

- [ ] **Step 8: Escribir la pantalla**

Crear `setup/renderer/index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>RunQA Setup</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>Preparando tu equipo</h1>
      <p class="intro">
        Esto deja todo listo para usar RunQA. Vas a necesitar unos minutos y conexión a internet.
        Ejecutalo con tu propia cuenta de administrador.
      </p>
      <ul id="pasos"></ul>
      <p class="error" id="error" hidden></p>
      <div class="acciones">
        <button id="empezar">Empezar</button>
        <button id="registro" class="secundario">Ver detalles</button>
      </div>
    </main>
    <script src="setup.js"></script>
  </body>
</html>
```

Crear `setup/renderer/styles.css` (mismos tokens visuales que RunQA):

```css
:root {
  --fondo: #0f1420;
  --panel: #161d2c;
  --texto: #e6ebf5;
  --tenue: #8b96ab;
  --accent: #3b82f6;
  --ok: #22c55e;
  --error: #ef4444;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px;
  font-family: "Segoe UI", system-ui, sans-serif;
  background: var(--fondo); color: var(--texto);
}
h1 { font-size: 22px; margin: 0 0 8px; }
.intro { color: var(--tenue); font-size: 14px; margin: 0 0 24px; line-height: 1.5; }
ul { list-style: none; padding: 0; margin: 0 0 20px; }
li {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; margin-bottom: 8px;
  background: var(--panel); border-radius: 10px;
}
.marca { width: 20px; text-align: center; color: var(--tenue); }
li[data-status="done"] .marca { color: var(--ok); }
li[data-status="error"] .marca { color: var(--error); }
li[data-status="running"] .marca { color: var(--accent); }
.etiqueta { flex: 1; font-size: 14px; }
.barra { width: 90px; height: 4px; background: #24304a; border-radius: 2px; overflow: hidden; }
.barra span { display: block; height: 100%; background: var(--accent); width: 0; }
.error { color: var(--error); font-size: 13px; margin: 0 0 16px; }
.acciones { display: flex; gap: 12px; }
button {
  padding: 10px 20px; border: 0; border-radius: 8px;
  background: var(--accent); color: #fff; font-size: 14px; cursor: pointer;
}
button.secundario { background: transparent; color: var(--tenue); }
button:disabled { opacity: .5; cursor: default; }
```

Crear `setup/renderer/setup.js`:

```js
const MARCAS = { pending: '○', running: '▸', done: '✓', error: '✕' };

const lista = document.getElementById('pasos');
const aviso = document.getElementById('error');
const empezar = document.getElementById('empezar');

function pintar({ steps, error }) {
  lista.innerHTML = steps.map((paso) => `
    <li data-status="${paso.status}">
      <span class="marca">${MARCAS[paso.status]}</span>
      <span class="etiqueta">${paso.label}</span>
      ${paso.status === 'running' ? `<span class="barra"><span style="width:${paso.percent || 0}%"></span></span>` : ''}
      ${paso.status === 'error' ? `<button class="secundario" data-retry="${paso.id}">Reintentar</button>` : ''}
    </li>`).join('');

  aviso.hidden = !error;
  aviso.textContent = error || '';
  empezar.disabled = steps.some((paso) => paso.status === 'running');
  empezar.textContent = steps.every((paso) => paso.status === 'done') ? 'Listo' : 'Empezar';

  for (const boton of lista.querySelectorAll('[data-retry]')) {
    boton.onclick = () => window.setup.retry(boton.dataset.retry);
  }
}

window.setup.onState(pintar);
empezar.onclick = () => window.setup.start();
document.getElementById('registro').onclick = () => window.setup.openLog();
window.setup.refresh();
```

- [ ] **Step 9: Verificar sintaxis y correr toda la suite**

Run: `cd setup && node --check main.js && node --check preload.js && npm test`
Expected: sin salida de `node --check`; la suite entera en verde (25 tests entre las tareas 1-8).

- [ ] **Step 10: Commit**

```bash
git add setup/main.js setup/preload.js setup/main/run.js setup/main/log.js setup/renderer/ setup/test/run.test.js
git commit -m "feat(setup): orquestar los pasos y mostrarlos en una ventana"
```

---

### Task 9: RunQA resuelve git y npm sin depender del PATH

**Files:**
- Create: `electron-app/main/runtime/windows-paths.js`
- Modify: `electron-app/main/projects.js:77` (parámetros por defecto de `createProjectManager`)
- Create: `electron-app/test/windows-paths.test.js`

**Interfaces:**
- Consumes: nada del setup (es un módulo propio de la app; la duplicación con `setup/main/paths.js` es deliberada, son dos artefactos independientes).
- Produces: `resolveCommand(nombre, { exists, env, platform })` → string. Devuelve el nombre tal cual si no hay una ruta conocida que exista.

- [ ] **Step 1: Escribir el test que falla**

Crear `electron-app/test/windows-paths.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveCommand } = require('../main/runtime/windows-paths');

// Deliberadamente distinto del valor por defecto del módulo: si fuera
// 'C:\\Program Files', un módulo que ignorara `env` pasaría igual los tests.
const ENV = { ProgramFiles: 'D:\\Programas' };

test('en Windows usa la ruta conocida cuando el archivo existe', () => {
  const ruta = resolveCommand('git', { exists: () => true, env: ENV, platform: 'win32' });
  assert.equal(ruta, path.join('D:\\Programas', 'Git', 'cmd', 'git.exe'));
});

test('si la ruta conocida no existe deja el nombre para que lo busque el sistema', () => {
  const ruta = resolveCommand('git', { exists: () => false, env: ENV, platform: 'win32' });
  assert.equal(ruta, 'git');
});

test('npm resuelve al .cmd de Node', () => {
  const ruta = resolveCommand('npm.cmd', { exists: () => true, env: ENV, platform: 'win32' });
  assert.equal(ruta, path.join('D:\\Programas', 'nodejs', 'npm.cmd'));
});

test('fuera de Windows no toca nada', () => {
  assert.equal(resolveCommand('git', { exists: () => true, env: ENV, platform: 'linux' }), 'git');
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd electron-app && node --test test/windows-paths.test.js`
Expected: FAIL — `Cannot find module '../main/runtime/windows-paths'`.

- [ ] **Step 3: Implementar**

Crear `electron-app/main/runtime/windows-paths.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

/**
 * Cuando el instalador abre RunQA con "Ejecutar al terminar", el proceso hereda
 * el PATH viejo: git y Node recién instalados todavía no figuran ahí. Por eso
 * probamos primero las rutas donde los deja RunQA Setup.
 */
const CONOCIDAS = {
  git: ['Git', 'cmd', 'git.exe'],
  'npm.cmd': ['nodejs', 'npm.cmd'],
  npm: ['nodejs', 'npm.cmd'],
};

function resolveCommand(nombre, { exists = fs.existsSync, env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return nombre;
  const partes = CONOCIDAS[nombre];
  if (!partes) return nombre;
  const ruta = path.join(env.ProgramFiles || 'C:\\Program Files', ...partes);
  return exists(ruta) ? ruta : nombre;
}

module.exports = { resolveCommand };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd electron-app && node --test test/windows-paths.test.js`
Expected: 4 pass.

- [ ] **Step 5: Engancharlo en `createProjectManager`**

En `electron-app/main/projects.js`, agregar el require junto a los demás del inicio del archivo:

```js
const { resolveCommand } = require('./runtime/windows-paths');
```

y cambiar la firma (línea 77):

```js
function createProjectManager({ projectsDir, gitPath = 'git', npmPath = process.platform === 'win32' ? 'npm.cmd' : 'npm', run = runFile, auth = NO_AUTH }) {
```

por:

```js
function createProjectManager({
  projectsDir,
  gitPath = resolveCommand('git'),
  npmPath = resolveCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm'),
  run = runFile,
  auth = NO_AUTH,
}) {
```

`needsShell(npmPath)` sigue funcionando: la ruta resuelta termina en `.cmd`, así que la detección por extensión no cambia.

- [ ] **Step 6: Correr la suite completa de la app**

Run: `cd electron-app && npm test`
Expected: 257/257 pass (253 de base + los 4 nuevos). Los tests de `projects.test.js` inyectan `gitPath`/`npmPath` explícitamente, así que no se ven afectados.

- [ ] **Step 7: Commit**

```bash
git add electron-app/main/runtime/windows-paths.js electron-app/main/projects.js electron-app/test/windows-paths.test.js
git commit -m "fix: encontrar git y npm recién instalados sin depender del PATH heredado"
```

---

### Task 10: Aviso cuando los navegadores no coinciden con el proyecto

**Files:**
- Create: `electron-app/main/playwright/browsers.js`
- Modify: `electron-app/main/projects.js` (dentro de `installDependencies`)
- Create: `electron-app/test/browsers.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `checkBrowsers({ repoPath, readMarker, readPackage })` → `{ ok, expected, installed }`. `repoPlaywrightVersion(repoPath, readPackage)` → string|null.

- [ ] **Step 1: Escribir el test que falla**

Crear `electron-app/test/browsers.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkBrowsers } = require('../main/playwright/browsers');

const repo = 'C:\\proyectos\\erp';

test('coinciden versión del proyecto y navegadores instalados', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => ({ version: '1.58.2' }),
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(estado, { ok: true, expected: '1.58.2', installed: '1.58.2' });
});

test('el proyecto pide otra versión que la instalada', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => ({ version: '1.49.0' }),
    readMarker: () => ({ playwrightVersion: '1.58.2' }),
  });
  assert.deepEqual(estado, { ok: false, expected: '1.49.0', installed: '1.58.2' });
});

test('sin navegadores instalados avisa igual', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => ({ version: '1.58.2' }),
    readMarker: () => null,
  });
  assert.deepEqual(estado, { ok: false, expected: '1.58.2', installed: null });
});

test('si no se puede leer la versión del proyecto no bloquea', () => {
  const estado = checkBrowsers({
    repoPath: repo,
    readPackage: () => null,
    readMarker: () => null,
  });
  assert.equal(estado.ok, true);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd electron-app && node --test test/browsers.test.js`
Expected: FAIL — `Cannot find module '../main/playwright/browsers'`.

- [ ] **Step 3: Implementar**

Crear `electron-app/main/playwright/browsers.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

/**
 * RunQA Setup instala los navegadores con una versión fijada y deja un marcador.
 * Un proyecto que use otra versión de Playwright necesita otros binarios, y sin
 * esta comprobación el fallo aparece recién al correr, como "Executable doesn't
 * exist at ...". Preferimos decirlo antes y en castellano.
 */
const markerPath = (env = process.env) =>
  path.join(env.LOCALAPPDATA || '', 'ms-playwright', '.runqa-setup.json');

const leerJson = (ruta) => {
  try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); }
  catch { return null; }
};

function checkBrowsers({
  repoPath,
  readPackage = () => leerJson(path.join(repoPath, 'node_modules', 'playwright-core', 'package.json')),
  readMarker = () => leerJson(markerPath()),
}) {
  const expected = readPackage()?.version || null;
  const installed = readMarker()?.playwrightVersion || null;
  // Sin poder leer lo que pide el proyecto no tenemos con qué comparar: no bloqueamos.
  if (!expected) return { ok: true, expected: null, installed };
  return { ok: expected === installed, expected, installed };
}

module.exports = { checkBrowsers, markerPath };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd electron-app && node --test test/browsers.test.js`
Expected: 4 pass.

- [ ] **Step 5: Usarlo al terminar de instalar dependencias**

En `electron-app/main/projects.js`, agregar el require al inicio:

```js
const { checkBrowsers } = require('./playwright/browsers');
```

y en `installDependencies`, justo antes del `return currentHash` final, insertar:

```js
    const navegadores = checkBrowsers({ repoPath });
    if (!navegadores.ok) {
      throw appError(
        'BROWSERS_VERSION_MISMATCH',
        `Este proyecto necesita los navegadores de Playwright ${navegadores.expected}. Abrí RunQA Setup y ejecutalo de nuevo para instalarlos.`,
      );
    }
```

- [ ] **Step 6: Agregar el test de ese camino**

Agregar al final de `electron-app/test/projects.test.js`. Usa `temp()` (línea 9) y la misma forma que el caso "prepara el clon en detached HEAD", que ya ejercita `installDependencies` a través de `manager.prepare`:

```js
test('avisa cuando los navegadores instalados no sirven para el proyecto', async () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'node_modules', 'playwright'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'node_modules', 'playwright', 'cli.js'), '');
  fs.mkdirSync(path.join(repoPath, 'node_modules', 'playwright-core'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'node_modules', 'playwright-core', 'package.json'), '{"version":"1.49.0"}');
  fs.writeFileSync(path.join(repoPath, 'package-lock.json'), '{"lockfileVersion":3}');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoPath, 'package-lock.json'))).digest('hex');
  const run = async (command, args) => {
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args[0] === 'remote') return { stdout: 'https://example.test/qa.git\n', stderr: '' };
    if (args[0] === 'rev-parse') return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };

  const previo = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = temp(); // un perfil sin el marcador de RunQA Setup
  try {
    const manager = createProjectManager({ projectsDir, run });
    await assert.rejects(
      () => manager.prepare({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main', dependencyLockHash: hash }),
      (err) => err.code === 'BROWSERS_VERSION_MISMATCH',
    );
  } finally {
    if (previo === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previo;
  }
});
```

El resto de los tests de ese archivo no crean `node_modules/playwright-core`, así que `checkBrowsers` no encuentra versión esperada, devuelve `ok: true` y no los altera. Eso es justo lo que verifica el Step 7.

- [ ] **Step 7: Correr la suite completa**

Run: `cd electron-app && npm test`
Expected: 262/262 pass (257 de la Task 9 + 4 de `browsers.test.js` + 1 en `projects.test.js`).

- [ ] **Step 8: Commit**

```bash
git add electron-app/main/playwright/browsers.js electron-app/main/projects.js electron-app/test/browsers.test.js electron-app/test/projects.test.js
git commit -m "feat: avisar cuando los navegadores instalados no sirven para el proyecto"
```

---

### Task 11: Publicación y documentación

**Files:**
- Create: `.github/workflows/release-setup.yml`
- Create: `setup/README.md`
- Modify: `electron-app/README.md` (sección "Experiencia del instalador de Windows")

**Interfaces:**
- Consumes: el `npm run dist` de la Task 1.
- Produces: nada que consuma otra tarea.

- [ ] **Step 1: Escribir el workflow**

Crear `.github/workflows/release-setup.yml`:

```yaml
name: Publicar RunQA Setup

on:
  workflow_dispatch:
  push:
    tags:
      - 'setup-v*.*.*'

permissions:
  contents: write

jobs:
  windows:
    runs-on: windows-latest
    defaults:
      run:
        working-directory: setup
    steps:
      - name: Descargar código
        uses: actions/checkout@v4

      - name: Preparar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Instalar dependencias
        run: npm install

      - name: Validar versión de la etiqueta
        if: github.event_name == 'push'
        shell: pwsh
        run: |
          $packageVersion = node -p "require('./package.json').version"
          if ("setup-v$packageVersion" -ne "${{ github.ref_name }}") {
            throw "La etiqueta ${{ github.ref_name }} no coincide con package.json v$packageVersion"
          }

      - name: Ejecutar pruebas
        run: npm test

      - name: Construir el ejecutable
        run: npm run dist

      - name: Publicar en el release de la etiqueta
        if: github.event_name == 'push'
        shell: pwsh
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release create "${{ github.ref_name }}" (Get-Item "dist/RunQA Setup *.exe").FullName --title "RunQA Setup $("${{ github.ref_name }}" -replace 'setup-v','')" --notes "Prepara el equipo e instala RunQA."
```

El setup **no** usa el publicador de electron-builder: sus tags (`setup-v*`) no siguen el esquema `v${version}` que ese publicador asume, y mezclarlos ensuciaría los releases de RunQA. Por eso se sube con `gh release create`.

- [ ] **Step 2: Escribir el README del setup**

Crear `setup/README.md`:

```markdown
# RunQA Setup

Prepara un equipo Windows para RunQA y termina instalando la app. Es un
ejecutable suelto (no se instala) que pide permisos de administrador una sola
vez, al abrirlo.

## Qué hace

1. Revisa qué falta: la herramienta para traer los proyectos (git), el motor que
   instala sus dependencias (Node) y los navegadores de prueba.
2. Instala en silencio sólo lo que falta.
3. Descarga la última versión publicada de RunQA y la instala.

Volver a abrirlo sirve de reparación: lo que ya está se salta.

## Requisitos

- Windows 10 u 11, 64 bits.
- Cuenta de administrador **propia** del QA. Si se eleva con las credenciales de
  otra cuenta, los navegadores quedan en el perfil equivocado.
- Conexión a internet: descarga desde `github.com` y `nodejs.org`.

## Versiones de los prerequisitos

Todas viven en `prerequisites.json` — versión, dirección de descarga y sha256 de
git y Node, más la versión fijada de Playwright. Actualizar un prerequisito es
editar ese archivo y nada más.

La versión de Playwright debe seguir a la de los repositorios de pruebas: si un
proyecto usa otra, RunQA avisa y hay que volver a ejecutar el setup con el valor
corregido.

## Publicar una versión

```bash
cd setup
npm test
npm version patch --no-git-tag-version
git add package.json && git commit -m "release: RunQA Setup <version>"
git tag setup-v<version>
git push origin main setup-v<version>
```

La etiqueta dispara `.github/workflows/release-setup.yml`, que corre las pruebas,
construye el ejecutable y lo sube al release.

## Verificación manual antes de publicar

Sobre una máquina virtual limpia de Windows 11 x64, sin git ni Node:

- [ ] El ejecutable pide permisos una sola vez y abre la ventana.
- [ ] La lista muestra los tres requisitos como faltantes.
- [ ] "Empezar" los instala en orden y cada uno queda con su tilde.
- [ ] Cortar la red durante una descarga muestra el mensaje con el nombre del
      servidor, y "Reintentar" retoma ese paso.
- [ ] Al terminar arranca el instalador de RunQA.
- [ ] Reabrir el setup muestra los tres requisitos ya resueltos.
- [ ] Tras instalar, RunQA agrega un proyecto sin errores de git ni de npm.
```

- [ ] **Step 3: Actualizar el README de RunQA**

En `electron-app/README.md`, al final de la sección "Experiencia del instalador de Windows", agregar:

```markdown

### Antes del instalador: RunQA Setup

En un equipo nuevo, el QA no descarga este instalador directamente sino
`RunQA Setup`, que deja el equipo listo (herramienta para traer proyectos, motor
de dependencias y navegadores de prueba) y al terminar ejecuta este mismo
instalador. Ver [../setup/README.md](../setup/README.md).
```

Corregir también, en esa misma sección, la frase "La release debe contener el
instalador, su `.blockmap` y `latest.yml`": con el target `nsis-web` la release
contiene el instalador, el paquete `runqa-<versión>-x64.nsis.7z` y `latest.yml`
— no hay un `.blockmap` suelto.

- [ ] **Step 4: Verificar el YAML**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/release-setup.yml','utf8')" && echo ok`
Expected: `ok`. Si tenés `yamllint` disponible, corré también `yamllint .github/workflows/release-setup.yml`.

- [ ] **Step 5: Correr las dos suites**

Run: `cd setup && npm test && cd ../electron-app && npm test`
Expected: setup en verde y `electron-app` en 262/262.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release-setup.yml setup/README.md electron-app/README.md
git commit -m "docs(setup): publicar el bootstrapper y documentar su uso"
```

---

## Verificación final

- [ ] `cd setup && npm test` — verde.
- [ ] `cd electron-app && npm test` — 262/262.
- [ ] `cd setup && npm run dist` genera `dist/RunQA Setup 1.0.0.exe` (requiere Windows o Wine).
- [ ] Checklist manual de `setup/README.md` completo sobre una VM limpia.
