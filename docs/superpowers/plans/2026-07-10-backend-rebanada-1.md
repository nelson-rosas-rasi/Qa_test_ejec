# Backend Rebanada 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar `tests:getTree`, `run:start` y `run:stop` a un repositorio Playwright real, para que la app liste y ejecute pruebas de verdad con resultados en vivo.

**Architecture:** Módulos puros bajo `electron-app/main/` que no importan `electron`; `ipc.js` es el único que traduce entre Electron y esos módulos. Playwright se lanza con el Node que trae Electron (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`) usando el `cli.js` del repo de pruebas, con un reporter NDJSON propio que emite una línea JSON por evento.

**Tech Stack:** Electron 30, Node 20 (embebido), `node:test` como runner, `@playwright/test` 1.58.2 en el repo de pruebas.

**Spec:** [`docs/superpowers/specs/2026-07-10-backend-rebanada-1-design.md`](../specs/2026-07-10-backend-rebanada-1-design.md)

---

## Convenciones

- Todos los comandos se ejecutan desde `electron-app/` salvo que se diga lo contrario.
- `git` se ejecuta desde la raíz del proyecto (`QA Test Runner mockups/`).
- El repo real `rasierp-e2e` **nunca** se usa para pruebas automatizadas: corre contra un ERP en producción con credenciales reales. Solo se usa en la verificación manual final, y solo para *listar*.

---

### Task 1: Versionar el proyecto y añadir el runner de pruebas

**Files:**
- Create: `.gitignore`
- Modify: `electron-app/package.json`

- [ ] **Step 1: Inicializar el repositorio**

Desde la raíz del proyecto:

```bash
git init
git config user.name "$(git config user.name || echo 'QA Test Runner')"
```

- [ ] **Step 2: Crear `.gitignore`**

Archivo `.gitignore` en la raíz:

```gitignore
node_modules/
dist/
test-results/
playwright-report/
.last-test-results.json

# Los .env reales nunca se versionan…
.env
.env.*
# …pero los del repo de juguete no tienen secretos y son parte de las pruebas.
!electron-app/test-fixtures/sample-repo/.env.*
```

- [ ] **Step 3: Añadir el script de pruebas**

En `electron-app/package.json`, dentro de `"scripts"`, añadir la línea `"test"` dejando las existentes:

```json
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder",
    "test": "node --test \"test/*.test.js\""
  },
```

Node 24 ya no acepta un directorio como argumento de `--test` (intenta cargarlo
como módulo y falla con `MODULE_NOT_FOUND`). El glob sí funciona, y con cero
archivos coincidentes sale limpio.

- [ ] **Step 4: Crear la carpeta de pruebas y verificar que el runner arranca**

```bash
mkdir -p electron-app/test && touch electron-app/test/.gitkeep
```

Run (desde `electron-app/`): `npm test`
Expected: `# pass 0`, `# fail 0`, exit 0

- [ ] **Step 5: Commit**

```bash
git add .gitignore electron-app/package.json electron-app/test/.gitkeep
git add electron-app/main.js electron-app/preload.js electron-app/renderer electron-app/mock electron-app/README.md electron-app/package-lock.json
git add docs/
git commit -m "chore: versionar el mockup y añadir node:test como runner"
```

---

### Task 2: Errores con código

**Files:**
- Create: `electron-app/main/errors.js`
- Test: `electron-app/test/errors.test.js`

- [ ] **Step 1: Escribir la prueba que falla**

`electron-app/test/errors.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { appError } = require('../main/errors');

test('appError produce un Error con código y mensaje', () => {
  const err = appError('NO_PROFILE', 'No hay perfiles.');
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'NO_PROFILE');
  assert.equal(err.message, 'No hay perfiles.');
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/errors'`

- [ ] **Step 3: Implementación mínima**

`electron-app/main/errors.js`:

```js
/** Error de aplicación con un código estable que `ipc.js` traduce a un mensaje para el QA. */
function appError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

module.exports = { appError };
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `npm test`
Expected: PASS — `# pass 1`

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/errors.js electron-app/test/errors.test.js
git commit -m "feat: errores de aplicación con código"
```

---

### Task 3: Almacén de configuración

**Files:**
- Create: `electron-app/main/config-store.js`
- Test: `electron-app/test/config-store.test.js`

- [ ] **Step 1: Escribir las pruebas que fallan**

`electron-app/test/config-store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore } = require('../main/config-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-config-'));
}

test('getProject devuelve un objeto vacío cuando no hay archivo', () => {
  const store = createConfigStore(tempDir());
  assert.deepEqual(store.getProject('erp'), {});
});

test('setProject persiste y getProject lo lee de vuelta', () => {
  const dir = tempDir();
  createConfigStore(dir).setProject('erp', { repoPath: 'C:/qa/erp' });
  assert.deepEqual(createConfigStore(dir).getProject('erp'), { repoPath: 'C:/qa/erp' });
});

test('setProject mezcla en vez de reemplazar', () => {
  const store = createConfigStore(tempDir());
  store.setProject('erp', { repoPath: 'C:/qa/erp' });
  store.setProject('erp', { profile: 'demo' });
  assert.deepEqual(store.getProject('erp'), { repoPath: 'C:/qa/erp', profile: 'demo' });
});

test('un archivo corrupto no rompe la app', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ esto no es json');
  assert.deepEqual(createConfigStore(dir).getProject('erp'), {});
});

test('los proyectos no se pisan entre sí', () => {
  const store = createConfigStore(tempDir());
  store.setProject('erp', { profile: 'a' });
  store.setProject('medical', { profile: 'b' });
  assert.equal(store.getProject('erp').profile, 'a');
  assert.equal(store.getProject('medical').profile, 'b');
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/config-store'`

- [ ] **Step 3: Implementación mínima**

`electron-app/main/config-store.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

/**
 * Recibe la carpeta de configuración como argumento (no importa `electron`),
 * para poder probarlo contra un directorio temporal.
 */
function createConfigStore(dir) {
  const file = path.join(dir, 'config.json');

  function readAll() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data && typeof data === 'object' ? data : { projects: {} };
    } catch {
      return { projects: {} };
    }
  }

  return {
    getProject(projectId) {
      const data = readAll();
      return (data.projects && data.projects[projectId]) || {};
    },

    setProject(projectId, patch) {
      const data = readAll();
      if (!data.projects) data.projects = {};
      data.projects[projectId] = { ...data.projects[projectId], ...patch };
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
      return data.projects[projectId];
    },
  };
}

module.exports = { createConfigStore };
```

- [ ] **Step 4: Correr para verificar que pasa**

Run: `npm test`
Expected: PASS — `# pass 6`

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/config-store.js electron-app/test/config-store.test.js
git commit -m "feat: almacén de configuración por proyecto"
```

---

### Task 4: Perfiles de QA

Lista los `.env.<perfil>` de un repo y lee **solo** `QA_NOMBRE` y `QA_CARGO`. `TEST_PASSWORD` nunca sale de este módulo.

**Files:**
- Create: `electron-app/main/profiles.js`
- Test: `electron-app/test/profiles.test.js`

- [ ] **Step 1: Escribir las pruebas que fallan**

`electron-app/test/profiles.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listProfiles } = require('../main/profiles');

function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-profiles-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

test('lista los perfiles con su nombre y cargo', () => {
  const dir = repoWith({
    '.env.demo': 'QA_NOMBRE=Ana Ruiz\nQA_CARGO=QA Lead\nTEST_PASSWORD=secreta\n',
    '.env.otro': 'QA_NOMBRE=Beto Paz\nQA_CARGO=QA Tester\n',
  });
  assert.deepEqual(listProfiles(dir), [
    { id: 'demo', name: 'Ana Ruiz', role: 'QA Lead' },
    { id: 'otro', name: 'Beto Paz', role: 'QA Tester' },
  ]);
});

test('ignora .env.example', () => {
  const dir = repoWith({
    '.env.demo': 'QA_NOMBRE=Ana Ruiz\n',
    '.env.example': 'QA_NOMBRE=Plantilla\n',
  });
  assert.deepEqual(listProfiles(dir).map((p) => p.id), ['demo']);
});

test('nunca expone la contraseña', () => {
  const dir = repoWith({ '.env.demo': 'QA_NOMBRE=Ana\nTEST_PASSWORD=clave-falsa-NUNCA-filtrar\n' });
  assert.ok(!JSON.stringify(listProfiles(dir)).includes('clave-falsa'));
});

test('cae al id del perfil cuando falta QA_NOMBRE', () => {
  const dir = repoWith({ '.env.nelson': 'BASE_URL=https://ejemplo\n' });
  assert.deepEqual(listProfiles(dir), [{ id: 'nelson', name: 'nelson', role: 'QA' }]);
});

test('ignora comentarios y líneas sin =', () => {
  const dir = repoWith({ '.env.demo': '# QA_NOMBRE=Falso\nbasura\nQA_NOMBRE="Ana Ruiz"\n' });
  assert.equal(listProfiles(dir)[0].name, 'Ana Ruiz');
});

test('un repo sin perfiles lanza NO_PROFILE', () => {
  const dir = repoWith({ 'package.json': '{}' });
  assert.throws(() => listProfiles(dir), (err) => err.code === 'NO_PROFILE');
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/profiles'`

- [ ] **Step 3: Implementación mínima**

`electron-app/main/profiles.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { appError } = require('./errors');

/** Las únicas claves que este módulo tiene permitido leer de un .env. */
const VISIBLE_KEYS = ['QA_NOMBRE', 'QA_CARGO'];

function readVisibleKeys(filePath) {
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!VISIBLE_KEYS.includes(key)) continue;
    values[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

function listProfiles(repoPath) {
  const files = fs
    .readdirSync(repoPath)
    .filter((f) => f.startsWith('.env.') && !f.endsWith('.example'));

  if (files.length === 0) {
    throw appError(
      'NO_PROFILE',
      'Este proyecto no tiene perfiles de QA configurados. Falta un archivo .env con tu usuario.',
    );
  }

  return files
    .map((f) => {
      const id = f.slice('.env.'.length);
      const values = readVisibleKeys(path.join(repoPath, f));
      return { id, name: values.QA_NOMBRE || id, role: values.QA_CARGO || 'QA' };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

module.exports = { listProfiles, readVisibleKeys };
```

- [ ] **Step 4: Correr para verificar que pasa**

Run: `npm test`
Expected: PASS — `# pass 12`

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/profiles.js electron-app/test/profiles.test.js
git commit -m "feat: listar perfiles de QA sin exponer credenciales"
```

---

### Task 5: Repo Playwright de juguete

Material real contra el cual probar el listado y la ejecución, sin tocar el ERP de producción.

**Files:**
- Create: `electron-app/test-fixtures/sample-repo/package.json`
- Create: `electron-app/test-fixtures/sample-repo/playwright.config.ts`
- Create: `electron-app/test-fixtures/sample-repo/.env.demo`
- Create: `electron-app/test-fixtures/sample-repo/.env.example`
- Create: `electron-app/test-fixtures/sample-repo/tests/alpha/ok.spec.ts`
- Create: `electron-app/test-fixtures/sample-repo/tests/alpha/mixed.spec.ts`
- Create: `electron-app/test-fixtures/sample-repo/tests/slow.spec.ts`

- [ ] **Step 1: `package.json` del repo de juguete**

```json
{
  "name": "sample-repo",
  "private": true,
  "devDependencies": {
    "@playwright/test": "1.58.2"
  }
}
```

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
```

- [ ] **Step 3: Perfiles de juguete**

`.env.demo` (la contraseña es falsa; existe para probar que nunca se filtra):

```dotenv
QA_NOMBRE=Ana Ruiz
QA_CARGO=QA Lead
TEST_PASSWORD=contrasena-falsa-de-prueba
```

`.env.example`:

```dotenv
QA_NOMBRE=Plantilla
QA_CARGO=QA Tester
```

- [ ] **Step 4: Las pruebas de juguete**

`tests/alpha/ok.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('suma dos números', () => {
  expect(1 + 1).toBe(2);
});
```

`tests/alpha/mixed.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('operaciones', () => {
  test('resta', () => {
    expect(3 - 1).toBe(2);
  });

  test('falla a propósito', () => {
    expect(1).toBe(2);
  });

  test.skip('omitida', () => {
    expect(true).toBe(true);
  });
});
```

`tests/slow.spec.ts` (archivo en la raíz → suite "General"; sirve para probar el apagado):

```ts
import { test } from '@playwright/test';

test('tarda mucho', async () => {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
});
```

- [ ] **Step 5: Instalar Playwright en el repo de juguete**

Ninguna prueba abre un navegador, así que **no** hace falta `playwright install`.

```bash
cd electron-app/test-fixtures/sample-repo && npm install && cd ../../..
```

Expected: crea `electron-app/test-fixtures/sample-repo/node_modules/playwright/cli.js`

- [ ] **Step 6: Verificar que el repo de juguete lista sus pruebas**

Run (desde `electron-app/test-fixtures/sample-repo`): `npx playwright test --list`
Expected: 5 pruebas — `ok.spec.ts` (1), `mixed.spec.ts` (3), `slow.spec.ts` (1)

- [ ] **Step 7: Commit**

```bash
git add electron-app/test-fixtures/sample-repo
git commit -m "test: repo Playwright de juguete para pruebas de integración"
```

---

### Task 6: Localizar el CLI de Playwright

**Files:**
- Create: `electron-app/main/playwright/locate.js`
- Test: `electron-app/test/locate.test.js`

- [ ] **Step 1: Escribir las pruebas que fallan**

`electron-app/test/locate.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { locatePlaywrightCli } = require('../main/playwright/locate');

const SAMPLE_REPO = path.join(__dirname, '..', 'test-fixtures', 'sample-repo');

test('encuentra el cli.js del repo de juguete', () => {
  const cli = locatePlaywrightCli(SAMPLE_REPO);
  assert.ok(fs.existsSync(cli));
  assert.ok(cli.endsWith(path.join('playwright', 'cli.js')));
});

test('un repo sin Playwright lanza PLAYWRIGHT_NOT_INSTALLED', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-locate-'));
  assert.throws(() => locatePlaywrightCli(dir), (err) => err.code === 'PLAYWRIGHT_NOT_INSTALLED');
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/playwright/locate'`

- [ ] **Step 3: Implementación mínima**

`electron-app/main/playwright/locate.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { appError } = require('../errors');

/**
 * Usa el Playwright *del repo*, nunca uno global: es la única forma de correr la
 * misma versión con la que el equipo escribió las pruebas.
 */
function locatePlaywrightCli(repoPath) {
  const cli = path.join(repoPath, 'node_modules', 'playwright', 'cli.js');
  if (!fs.existsSync(cli)) {
    throw appError(
      'PLAYWRIGHT_NOT_INSTALLED',
      'Este proyecto no tiene sus dependencias instaladas. Pídele a alguien del equipo que las instale.',
    );
  }
  return cli;
}

module.exports = { locatePlaywrightCli };
```

- [ ] **Step 4: Correr para verificar que pasa**

Run: `npm test`
Expected: PASS — `# pass 14`

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/playwright/locate.js electron-app/test/locate.test.js
git commit -m "feat: localizar el CLI de Playwright del repo"
```

---

### Task 7: Construir el árbol de pruebas

Función pura: recibe el JSON de `--list` y devuelve el árbol Suite → Archivo → Prueba que el renderer ya sabe pintar.

**Files:**
- Create: `electron-app/main/playwright/build-tree.js`
- Test: `electron-app/test/build-tree.test.js`

- [ ] **Step 1: Escribir las pruebas que fallan**

`electron-app/test/build-tree.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTree } = require('../main/playwright/build-tree');

/** Imita la forma real de `playwright test --list --reporter=json`. */
const LIST_JSON = {
  suites: [
    {
      title: 'alpha/mixed.spec.ts',
      specs: [],
      suites: [
        {
          title: 'operaciones',
          specs: [
            { title: 'resta', file: 'alpha/mixed.spec.ts', line: 4, column: 3 },
            { title: 'falla', file: 'alpha/mixed.spec.ts', line: 8, column: 3 },
          ],
        },
      ],
    },
    {
      title: 'alpha/ok.spec.ts',
      specs: [{ title: 'suma', file: 'alpha/ok.spec.ts', line: 3, column: 1 }],
      suites: [],
    },
    {
      title: 'slow.spec.ts',
      specs: [{ title: 'tarda mucho', file: 'slow.spec.ts', line: 3, column: 1 }],
      suites: [],
    },
  ],
  errors: [],
};

test('agrupa por carpeta y ordena alfabéticamente', () => {
  const tree = buildTree(LIST_JSON);
  assert.deepEqual(tree.map((s) => s.id), ['alpha', 'General']);
});

test('los archivos sin carpeta caen en General', () => {
  const general = buildTree(LIST_JSON).find((s) => s.id === 'General');
  assert.deepEqual(general.files.map((f) => f.name), ['slow.spec.ts']);
});

test('los ids de prueba son archivo:línea', () => {
  const alpha = buildTree(LIST_JSON).find((s) => s.id === 'alpha');
  const ok = alpha.files.find((f) => f.name === 'ok.spec.ts');
  assert.deepEqual(ok.tests, [{ id: 'alpha/ok.spec.ts:3', name: 'suma' }]);
});

test('el nombre de una prueba anidada incluye su describe', () => {
  const alpha = buildTree(LIST_JSON).find((s) => s.id === 'alpha');
  const mixed = alpha.files.find((f) => f.name === 'mixed.spec.ts');
  assert.deepEqual(mixed.tests.map((t) => t.name), ['operaciones > resta', 'operaciones > falla']);
});

test('el id del archivo es su ruta relativa', () => {
  const alpha = buildTree(LIST_JSON).find((s) => s.id === 'alpha');
  assert.deepEqual(alpha.files.map((f) => f.id), ['alpha/mixed.spec.ts', 'alpha/ok.spec.ts']);
});

test('errores de compilación lanzan LIST_FAILED con el detalle', () => {
  const broken = { suites: [], errors: [{ message: "Cannot find name 'foo'" }] };
  assert.throws(
    () => buildTree(broken),
    (err) => err.code === 'LIST_FAILED' && err.message.includes("Cannot find name 'foo'"),
  );
});

test('un repo sin pruebas devuelve un árbol vacío', () => {
  assert.deepEqual(buildTree({ suites: [], errors: [] }), []);
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/playwright/build-tree'`

- [ ] **Step 3: Implementación mínima**

`electron-app/main/playwright/build-tree.js`:

```js
const { appError } = require('../errors');

/**
 * El JSON de `--list` anida: suite de archivo → suites de `describe` → specs.
 * `spec.file` viene relativo a rootDir y siempre con `/`, incluso en Windows.
 */
function collectSpecs(suite, ancestors, out) {
  for (const spec of suite.specs || []) {
    out.push({ file: spec.file, line: spec.line, name: [...ancestors, spec.title].join(' > ') });
  }
  for (const child of suite.suites || []) {
    collectSpecs(child, [...ancestors, child.title], out);
  }
}

function buildTree(listJson) {
  if (Array.isArray(listJson.errors) && listJson.errors.length > 0) {
    const detail = listJson.errors.map((e) => e.message || String(e)).join('\n');
    throw appError('LIST_FAILED', `Playwright no pudo leer las pruebas:\n${detail}`);
  }

  const specs = [];
  for (const fileSuite of listJson.suites || []) collectSpecs(fileSuite, [], specs);

  const suites = new Map();
  for (const spec of specs) {
    const parts = spec.file.split('/');
    const suiteName = parts.length > 1 ? parts[0] : 'General';
    const fileName = parts[parts.length - 1];

    if (!suites.has(suiteName)) suites.set(suiteName, new Map());
    const files = suites.get(suiteName);
    if (!files.has(spec.file)) files.set(spec.file, { id: spec.file, name: fileName, tests: [] });
    files.get(spec.file).tests.push({ id: `${spec.file}:${spec.line}`, name: spec.name });
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'es');

  return [...suites.entries()]
    .map(([name, files]) => ({ id: name, name, files: [...files.values()].sort(byName) }))
    .sort(byName);
}

module.exports = { buildTree };
```

- [ ] **Step 4: Correr para verificar que pasa**

Run: `npm test`
Expected: PASS — `# pass 21`

Nota: `'alpha'.localeCompare('General', 'es')` devuelve `-1`, así que `alpha` va primero. Si la aserción del primer test falla, es que la locale no está disponible: revisar antes de tocar el código.

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/playwright/build-tree.js electron-app/test/build-tree.test.js
git commit -m "feat: construir el árbol de pruebas desde el JSON de --list"
```

---

### Task 8: Listar las pruebas de un repo real

**Files:**
- Create: `electron-app/main/playwright/list-tests.js`
- Test: `electron-app/test/list-tests.test.js`

- [ ] **Step 1: Escribir la prueba de integración que falla**

`electron-app/test/list-tests.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { listTests } = require('../main/playwright/list-tests');
const { locatePlaywrightCli } = require('../main/playwright/locate');

const SAMPLE_REPO = path.join(__dirname, '..', 'test-fixtures', 'sample-repo');

test('lista las pruebas del repo de juguete', { timeout: 90_000 }, async () => {
  const tree = await listTests({ repoPath: SAMPLE_REPO, cliPath: locatePlaywrightCli(SAMPLE_REPO) });

  assert.deepEqual(tree.map((s) => s.id), ['alpha', 'General']);

  const alpha = tree.find((s) => s.id === 'alpha');
  assert.deepEqual(alpha.files.map((f) => f.name), ['mixed.spec.ts', 'ok.spec.ts']);

  const mixed = alpha.files.find((f) => f.name === 'mixed.spec.ts');
  assert.equal(mixed.tests.length, 3);
  assert.ok(mixed.tests.every((t) => /^alpha\/mixed\.spec\.ts:\d+$/.test(t.id)));
  assert.ok(mixed.tests.every((t) => t.name.startsWith('operaciones > ')));
});

test('un repo inexistente lanza LIST_FAILED', { timeout: 90_000 }, async () => {
  await assert.rejects(
    () => listTests({ repoPath: path.join(SAMPLE_REPO, 'no-existe'), cliPath: locatePlaywrightCli(SAMPLE_REPO) }),
    (err) => err.code === 'LIST_FAILED',
  );
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/playwright/list-tests'`

- [ ] **Step 3: Implementación mínima**

`electron-app/main/playwright/list-tests.js`:

```js
const { execFile } = require('node:child_process');
const { buildTree } = require('./build-tree');
const { appError } = require('../errors');

/**
 * `nodePath` es `process.execPath`: en la app es el binario de Electron, que con
 * ELECTRON_RUN_AS_NODE=1 se comporta como Node. Así el QA no necesita Node instalado.
 */
function listTests({ repoPath, cliPath, nodePath = process.execPath }) {
  return new Promise((resolve, reject) => {
    execFile(
      nodePath,
      [cliPath, 'test', '--list', '--reporter=json'],
      {
        cwd: repoPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (!stdout) {
          return reject(appError('LIST_FAILED', (stderr || '').trim() || err?.message || 'Playwright no respondió.'));
        }
        // El config del repo puede imprimir antes del JSON; empezamos en la primera llave.
        const start = stdout.indexOf('{');
        if (start === -1) {
          return reject(appError('LIST_FAILED', 'Playwright no devolvió el listado de pruebas.'));
        }
        try {
          resolve(buildTree(JSON.parse(stdout.slice(start))));
        } catch (parseErr) {
          reject(parseErr.code ? parseErr : appError('LIST_FAILED', parseErr.message));
        }
      },
    );
  });
}

module.exports = { listTests };
```

- [ ] **Step 4: Correr para verificar que pasa**

Run: `npm test`
Expected: PASS — `# pass 23`

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/playwright/list-tests.js electron-app/test/list-tests.test.js
git commit -m "feat: listar las pruebas reales de un repo Playwright"
```

---

### Task 9: El reporter NDJSON

Se le inyecta a Playwright con `--reporter=<ruta>`. Emite una línea JSON por evento, prefijada con un sentinela para no confundirse con el `console.log` de otros reporters.

**Files:**
- Create: `electron-app/main/playwright/ndjson-reporter.cjs`

- [ ] **Step 1: Escribir el reporter**

`electron-app/main/playwright/ndjson-reporter.cjs`:

```js
const path = require('node:path');

const SENTINEL = '@@QATR@@';

/** Quita los códigos de color ANSI que Playwright mete en los mensajes de error. */
function plain(text) {
  return String(text).replace(/\[[0-9;]*m/g, '');
}

class NdjsonReporter {
  constructor() {
    this._rootDir = process.cwd();
  }

  printsToStdio() {
    return true;
  }

  onBegin(config, suite) {
    this._rootDir = config.rootDir;
    this._emit({ type: 'begin', total: suite.allTests().length });
  }

  onTestBegin(test, result) {
    this._emit({ type: 'testBegin', id: this._id(test), name: test.title, retry: result.retry });
  }

  onTestEnd(test, result) {
    const failed = result.status !== 'passed' && result.status !== 'skipped';
    this._emit({
      type: 'testEnd',
      id: this._id(test),
      name: test.title,
      status: result.status,
      retry: result.retry,
      willRetry: failed && result.retry < test.retries,
      durationMs: result.duration,
      error: result.error?.message ? plain(result.error.message).split('\n')[0].slice(0, 300) : null,
    });
  }

  onStdOut(chunk) {
    this._emit({ type: 'stdout', text: plain(chunk).trimEnd() });
  }

  onEnd(result) {
    this._emit({ type: 'end', status: result.status, durationMs: result.duration });
  }

  /** `cartera/nota-credito-clientes.spec.ts:22` — el mismo id que produce build-tree.js. */
  _id(test) {
    const rel = path.relative(this._rootDir, test.location.file).split(path.sep).join('/');
    return `${rel}:${test.location.line}`;
  }

  _emit(record) {
    process.stdout.write(SENTINEL + JSON.stringify(record) + '\n');
  }
}

module.exports = NdjsonReporter;
```

- [ ] **Step 2: Verificarlo a mano contra el repo de juguete**

Desde `electron-app/test-fixtures/sample-repo`:

```bash
npx playwright test alpha --reporter=../../main/playwright/ndjson-reporter.cjs
```

Expected: líneas que empiezan por `@@QATR@@{"type":"begin"...`, una `testBegin` y una `testEnd` por prueba, y una `end`. La prueba `falla a propósito` sale con `"status":"failed"`.

- [ ] **Step 3: Commit**

```bash
git add electron-app/main/playwright/ndjson-reporter.cjs
git commit -m "feat: reporter NDJSON para resultados en vivo"
```

---

### Task 10: Parsear y traducir los eventos

Módulo puro. El parser debe sobrevivir a que el stream corte una línea por la mitad — que es lo que pasa de verdad.

**Files:**
- Create: `electron-app/main/playwright/events.js`
- Test: `electron-app/test/events.test.js`

- [ ] **Step 1: Escribir las pruebas que fallan**

`electron-app/test/events.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStreamParser, translate, SENTINEL } = require('../main/playwright/events');

const line = (record) => SENTINEL + JSON.stringify(record) + '\n';

test('el parser ignora las líneas sin sentinela', () => {
  const seen = [];
  const feed = createStreamParser((r) => seen.push(r));
  feed('[Reporter] Resultados guardados\n');
  feed(line({ type: 'begin', total: 3 }));
  assert.deepEqual(seen, [{ type: 'begin', total: 3 }]);
});

test('el parser reensambla una línea partida a la mitad', () => {
  const seen = [];
  const feed = createStreamParser((r) => seen.push(r));
  const whole = line({ type: 'begin', total: 5 });
  feed(whole.slice(0, 12));
  feed(whole.slice(12));
  assert.deepEqual(seen, [{ type: 'begin', total: 5 }]);
});

test('el parser encuentra el sentinela aunque haya texto antes', () => {
  const seen = [];
  const feed = createStreamParser((r) => seen.push(r));
  feed('salida del test' + line({ type: 'end', status: 'passed', durationMs: 10 }));
  assert.equal(seen.length, 1);
});

test('el parser descarta JSON corrupto sin romperse', () => {
  const seen = [];
  const feed = createStreamParser((r) => seen.push(r));
  feed(SENTINEL + '{roto\n');
  feed(line({ type: 'begin', total: 1 }));
  assert.deepEqual(seen, [{ type: 'begin', total: 1 }]);
});

test('testBegin marca la prueba como corriendo', () => {
  assert.deepEqual(translate({ type: 'testBegin', id: 'a.spec.ts:3', name: 'x', retry: 0 }), [
    { channel: 'run:testResult', payload: { id: 'a.spec.ts:3', status: 'running' } },
  ]);
});

test('una prueba que pasa emite log verde y resultado', () => {
  const out = translate({ type: 'testEnd', id: 'a.spec.ts:3', name: 'suma', status: 'passed', retry: 0 });
  assert.deepEqual(out, [
    { channel: 'run:log', payload: { level: 'pass', text: 'suma' } },
    { channel: 'run:testResult', payload: { id: 'a.spec.ts:3', status: 'passed' } },
  ]);
});

test('una prueba que falla emite log rojo con el error', () => {
  const out = translate({
    type: 'testEnd', id: 'a.spec.ts:9', name: 'falla', status: 'failed', retry: 0, willRetry: false,
    error: 'expected 2 received 1',
  });
  assert.deepEqual(out, [
    { channel: 'run:log', payload: { level: 'fail', text: 'falla — expected 2 received 1' } },
    { channel: 'run:testResult', payload: { id: 'a.spec.ts:9', status: 'failed' } },
  ]);
});

test('timedOut e interrupted también cuentan como fallo', () => {
  for (const status of ['timedOut', 'interrupted']) {
    const out = translate({ type: 'testEnd', id: 'a:1', name: 'x', status, retry: 0, willRetry: false, error: null });
    assert.equal(out.at(-1).payload.status, 'failed');
  }
});

test('una prueba que va a reintentarse no marca resultado todavía', () => {
  const out = translate({ type: 'testEnd', id: 'a:1', name: 'inestable', status: 'failed', retry: 0, willRetry: true, error: 'boom' });
  assert.deepEqual(out, [
    { channel: 'run:log', payload: { level: 'muted', text: 'inestable — falló, reintentando…' } },
  ]);
});

test('una prueba que pasa en el reintento se anuncia como inestable', () => {
  const out = translate({ type: 'testEnd', id: 'a:1', name: 'resta', status: 'passed', retry: 1 });
  assert.deepEqual(out[0], {
    channel: 'run:log',
    payload: { level: 'muted', text: 'resta — inestable: pasó en el reintento' },
  });
  assert.equal(out.at(-1).payload.status, 'passed');
});

test('una prueba omitida solo deja rastro en la consola', () => {
  const out = translate({ type: 'testEnd', id: 'a:1', name: 'resta', status: 'skipped', retry: 0, willRetry: false });
  assert.deepEqual(out, [{ channel: 'run:log', payload: { level: 'muted', text: 'resta — omitida' } }]);
});

test('el stdout de una prueba se muestra en gris', () => {
  assert.deepEqual(translate({ type: 'stdout', text: 'hola' }), [
    { channel: 'run:log', payload: { level: 'muted', text: 'hola' } },
  ]);
});

test('el stdout vacío no ensucia la consola', () => {
  assert.deepEqual(translate({ type: 'stdout', text: '' }), []);
});

test('begin y end no producen eventos de UI', () => {
  assert.deepEqual(translate({ type: 'begin', total: 3 }), []);
  assert.deepEqual(translate({ type: 'end', status: 'passed', durationMs: 5 }), []);
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/playwright/events'`

- [ ] **Step 3: Implementación mínima**

`electron-app/main/playwright/events.js`:

```js
const SENTINEL = '@@QATR@@';

const FAILURE_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

const log = (level, text) => ({ channel: 'run:log', payload: { level, text } });
const result = (id, status) => ({ channel: 'run:testResult', payload: { id, status } });

/**
 * Acumula hasta ver un `\n`: el stream corta las líneas donde le da la gana.
 * Devuelve una función `feed(chunk)`.
 */
function createStreamParser(onRecord) {
  let buffer = '';
  return function feed(chunk) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const at = line.indexOf(SENTINEL);
      if (at === -1) continue;
      try {
        onRecord(JSON.parse(line.slice(at + SENTINEL.length)));
      } catch {
        // Línea corrupta: la app no se cae por una línea ilegible.
      }
    }
  };
}

/** Un registro del reporter → los eventos IPC que el renderer ya sabe consumir. */
function translate(record) {
  switch (record.type) {
    case 'testBegin':
      return [result(record.id, 'running')];

    case 'stdout':
      return record.text ? [log('muted', record.text)] : [];

    case 'testEnd': {
      if (record.willRetry) return [log('muted', `${record.name} — falló, reintentando…`)];
      if (record.status === 'skipped') return [log('muted', `${record.name} — omitida`)];

      if (record.status === 'passed') {
        const events = [];
        if (record.retry > 0) events.push(log('muted', `${record.name} — inestable: pasó en el reintento`));
        events.push(log('pass', record.name));
        events.push(result(record.id, 'passed'));
        return events;
      }

      if (FAILURE_STATUSES.has(record.status)) {
        const text = record.error ? `${record.name} — ${record.error}` : record.name;
        return [log('fail', text), result(record.id, 'failed')];
      }
      return [];
    }

    default:
      return [];
  }
}

module.exports = { createStreamParser, translate, SENTINEL };
```

- [ ] **Step 4: Correr para verificar que pasa**

Run: `npm test`
Expected: PASS — `# pass 37`

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/playwright/events.js electron-app/test/events.test.js
git commit -m "feat: parser NDJSON y traducción a eventos de UI"
```

---

### Task 11: Ejecutar las pruebas

**Files:**
- Create: `electron-app/main/playwright/run-tests.js`
- Test: `electron-app/test/run-tests.test.js`

- [ ] **Step 1: Escribir las pruebas que fallan**

`electron-app/test/run-tests.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runTests, buildArgs } = require('../main/playwright/run-tests');
const { locatePlaywrightCli } = require('../main/playwright/locate');

const SAMPLE_REPO = path.join(__dirname, '..', 'test-fixtures', 'sample-repo');
const REPORTER = path.join(__dirname, '..', 'main', 'playwright', 'ndjson-reporter.cjs');

test('buildArgs omite el filtro cuando se corre todo', () => {
  const args = buildArgs({ cliPath: 'cli.js', testIds: ['a:1'], runAll: true, reporters: ['r.cjs'] });
  assert.deepEqual(args, ['cli.js', 'test', '--reporter=r.cjs']);
});

test('buildArgs pasa los ids como filtro', () => {
  const args = buildArgs({ cliPath: 'cli.js', testIds: ['a:1', 'b:2'], runAll: false, reporters: ['r.cjs'] });
  assert.deepEqual(args, ['cli.js', 'test', 'a:1', 'b:2', '--reporter=r.cjs']);
});

test('buildArgs traduce las opciones de ejecución', () => {
  const args = buildArgs({ cliPath: 'cli.js', testIds: [], runAll: true, reporters: ['r.cjs'], visualMode: true, stopOnFail: true });
  assert.ok(args.includes('--headed'));
  assert.ok(args.includes('--max-failures=1'));
});

test('buildArgs une varios reporters con coma', () => {
  const args = buildArgs({ cliPath: 'cli.js', testIds: [], runAll: true, reporters: ['./json-reporter.cjs', '/abs/ndjson.cjs'] });
  assert.ok(args.includes('--reporter=./json-reporter.cjs,/abs/ndjson.cjs'));
});

test('ejecuta el repo de juguete y reporta resultados en vivo', { timeout: 120_000 }, async () => {
  const events = [];
  const { promise } = runTests(
    {
      repoPath: SAMPLE_REPO,
      cliPath: locatePlaywrightCli(SAMPLE_REPO),
      reporters: [REPORTER],
      testIds: ['alpha'],
      runAll: false,
    },
    (event) => events.push(event),
  );

  const { summary } = await promise;

  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped, 1);
  assert.ok(summary.durationMs > 0);

  const results = events.filter((e) => e.channel === 'run:testResult');
  assert.ok(results.some((e) => e.payload.status === 'running'), 'debe anunciar que arranca');
  assert.ok(results.some((e) => e.payload.status === 'failed'), 'debe reportar el fallo');

  const failLog = events.find((e) => e.channel === 'run:log' && e.payload.level === 'fail');
  assert.ok(failLog.payload.text.includes('falla a propósito'));

  const ids = results.map((e) => e.payload.id);
  assert.ok(ids.every((id) => /^alpha\/\w[\w.-]*\.spec\.ts:\d+$/.test(id)), `ids inesperados: ${ids}`);
});

test('stop() corta una corrida larga', { timeout: 120_000 }, async () => {
  const started = Date.now();
  const handle = runTests(
    {
      repoPath: SAMPLE_REPO,
      cliPath: locatePlaywrightCli(SAMPLE_REPO),
      reporters: [REPORTER],
      testIds: ['slow.spec.ts'],
      runAll: false,
    },
    () => {},
  );

  setTimeout(() => handle.stop(), 3000);
  const outcome = await handle.promise;

  assert.equal(outcome.stopped, true);
  assert.ok(Date.now() - started < 45_000, 'no debe esperar los 60s de la prueba');
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/playwright/run-tests'`

- [ ] **Step 3: Implementación mínima**

`electron-app/main/playwright/run-tests.js`:

```js
const { spawn } = require('node:child_process');
const { createStreamParser, translate } = require('./events');

function buildArgs({ cliPath, testIds, runAll, reporters, visualMode = false, stopOnFail = false }) {
  const args = [cliPath, 'test'];
  if (!runAll) args.push(...testIds);
  args.push(`--reporter=${reporters.join(',')}`);
  if (visualMode) args.push('--headed');
  if (stopOnFail) args.push('--max-failures=1');
  return args;
}

/**
 * Playwright lanza navegadores como *nietos*: matar solo al hijo los deja huérfanos.
 */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // El grupo ya murió.
    }
  }
}

/**
 * Devuelve `{ promise, stop }`. `onEvent` recibe `{ channel, payload }` listos para IPC.
 * No importa `electron`: quien llame decide qué hacer con los eventos.
 */
function runTests(options, onEvent) {
  const {
    repoPath, cliPath, reporters, nodePath = process.execPath, profile,
    testIds = [], runAll = false, visualMode = false, stopOnFail = false,
  } = options;

  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  if (profile) env.QA_PROFILE = profile;

  const child = spawn(nodePath, buildArgs({ cliPath, testIds, runAll, reporters, visualMode, stopOnFail }), {
    cwd: repoPath,
    env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const statuses = new Map();
  let durationMs = 0;
  let stopped = false;

  const feed = createStreamParser((record) => {
    if (record.type === 'testEnd' && !record.willRetry) statuses.set(record.id, record.status);
    if (record.type === 'end') durationMs = record.durationMs;
    for (const event of translate(record)) onEvent(event);
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', feed);

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text) => {
    const trimmed = text.trimEnd();
    if (trimmed) onEvent({ channel: 'run:log', payload: { level: 'muted', text: trimmed } });
  });

  const promise = new Promise((resolve) => {
    child.on('close', () => {
      const values = [...statuses.values()];
      resolve({
        ok: !stopped,
        stopped,
        summary: {
          passed: values.filter((s) => s === 'passed').length,
          failed: values.filter((s) => s !== 'passed' && s !== 'skipped').length,
          skipped: values.filter((s) => s === 'skipped').length,
          durationMs,
        },
      });
    });
    child.on('error', () => resolve({ ok: false, stopped, summary: { passed: 0, failed: 0, skipped: 0, durationMs: 0 } }));
  });

  return {
    promise,
    stop() {
      stopped = true;
      killTree(child);
    },
  };
}

module.exports = { runTests, buildArgs };
```

- [ ] **Step 4: Correr para verificar que pasa**

Run: `npm test`
Expected: PASS — `# pass 43`. La prueba de `stop()` debe terminar en unos 4 segundos, no en 60.

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/playwright/run-tests.js electron-app/test/run-tests.test.js
git commit -m "feat: ejecutar pruebas Playwright con streaming y apagado limpio"
```

---

### Task 12: Cablear el proceso principal

Aquí `main.js` se parte: queda solo la ventana. Los handlers se mueven a `ipc.js`, incluidos los que siguen simulados.

**Files:**
- Create: `electron-app/main/ipc.js`
- Modify: `electron-app/main.js` (reemplazo completo)
- Modify: `electron-app/preload.js`

- [ ] **Step 1: Escribir `main/ipc.js`**

```js
const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, dialog } = require('electron');

const { appError } = require('./errors');
const { createConfigStore } = require('./config-store');
const { listProfiles } = require('./profiles');
const { locatePlaywrightCli } = require('./playwright/locate');
const { listTests } = require('./playwright/list-tests');
const { runTests } = require('./playwright/run-tests');

const PROJECT_LABELS = { erp: 'ERP', medical: 'Medical', finance: 'Finanzas' };

/** Empaquetado: el reporter debe vivir fuera de app.asar para que Playwright pueda leerlo. */
function reporterPath() {
  const base = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked');
  return path.join(base, 'main', 'playwright', 'ndjson-reporter.cjs');
}

/** El reporter del repo (si lo tiene) sigue escribiendo .last-test-results.json para n8n. */
function reportersFor(repoPath) {
  const reporters = [];
  if (fs.existsSync(path.join(repoPath, 'json-reporter.cjs'))) reporters.push('./json-reporter.cjs');
  reporters.push(reporterPath());
  return reporters;
}

function registerIpc(getWindow) {
  const store = createConfigStore(app.getPath('userData'));
  let currentRun = null;

  const showError = (err) => dialog.showErrorBox('QA Test Runner', err.message || String(err));

  async function ensureRepoPath(projectId) {
    const saved = store.getProject(projectId).repoPath;
    if (saved && fs.existsSync(saved)) return saved;

    const answer = await dialog.showOpenDialog(getWindow(), {
      title: `Elige la carpeta del proyecto ${PROJECT_LABELS[projectId] || projectId}`,
      properties: ['openDirectory'],
    });
    if (answer.canceled || !answer.filePaths[0]) {
      throw appError('REPO_NOT_CONFIGURED', 'No elegiste una carpeta para este proyecto.');
    }
    store.setProject(projectId, { repoPath: answer.filePaths[0] });
    return answer.filePaths[0];
  }

  /* ---------- ventana ---------- */
  ipcMain.on('window:minimize', () => getWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => getWindow()?.close());

  /* ---------- pruebas ---------- */
  ipcMain.handle('tests:getTree', async (_event, projectId) => {
    try {
      const repoPath = await ensureRepoPath(projectId);
      return await listTests({ repoPath, cliPath: locatePlaywrightCli(repoPath) });
    } catch (err) {
      showError(err);
      return [];
    }
  });

  /* ---------- perfiles ---------- */
  ipcMain.handle('profiles:list', async (_event, projectId) => {
    try {
      return listProfiles(await ensureRepoPath(projectId));
    } catch (err) {
      showError(err);
      return [];
    }
  });

  ipcMain.handle('profiles:active', (_event, projectId) => store.getProject(projectId).profile || null);

  ipcMain.handle('profiles:select', (_event, projectId, profileId) => {
    store.setProject(projectId, { profile: profileId });
    return profileId;
  });

  /* ---------- ejecución ---------- */
  ipcMain.handle('run:start', async (event, payload) => {
    const { projectId = 'erp', testIds = [], runAll = false, visualMode = false, stopOnFail = false } = payload || {};
    const empty = { ok: false, stopped: false, summary: { passed: 0, failed: 0, skipped: 0, durationMs: 0 } };
    try {
      const repoPath = await ensureRepoPath(projectId);
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
      return await currentRun.promise;
    } catch (err) {
      showError(err);
      return empty;
    } finally {
      currentRun = null;
    }
  });

  ipcMain.on('run:stop', () => currentRun?.stop());

  /* ---------- todavía simulados (rebanadas siguientes) ---------- */
  ipcMain.handle('sync:checkStatus', async () => ({
    updateAvailable: true,
    newTestsCount: 3,
    lastSyncedAt: Date.now() - 5 * 60_000,
  }));

  ipcMain.handle('sync:update', async (event) => {
    for (let pct = 0; pct <= 100; pct += 20) {
      await new Promise((resolve) => setTimeout(resolve, 220));
      event.sender.send('sync:updateProgress', pct);
    }
    return { ok: true };
  });

  ipcMain.handle('report:generate', async (_event, runId) => ({ docPath: `/reportes/Reporte-${runId}.docx` }));

  ipcMain.handle('history:list', async () => require('../mock/history.json'));
}

module.exports = { registerIpc };
```

- [ ] **Step 2: Reemplazar `main.js` por completo**

```js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { registerIpc } = require('./main/ipc');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 640,
    frame: false, // usamos una barra de título propia (ver renderer/index.html)
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: Añadir los perfiles a `preload.js`**

Reemplazar el bloque `// datos` de `preload.js` añadiendo tres métodos, sin quitar ninguno:

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qa', {
  // ventana
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  // datos
  getTestTree: (projectId) => ipcRenderer.invoke('tests:getTree', projectId),
  checkSyncStatus: () => ipcRenderer.invoke('sync:checkStatus'),
  runUpdate: () => ipcRenderer.invoke('sync:update'),
  onUpdateProgress: (cb) => ipcRenderer.on('sync:updateProgress', (_e, pct) => cb(pct)),

  // perfiles de QA
  listProfiles: (projectId) => ipcRenderer.invoke('profiles:list', projectId),
  getActiveProfile: (projectId) => ipcRenderer.invoke('profiles:active', projectId),
  selectProfile: (projectId, profileId) => ipcRenderer.invoke('profiles:select', projectId, profileId),

  startRun: (payload) => ipcRenderer.invoke('run:start', payload),
  stopRun: () => ipcRenderer.send('run:stop'),
  onRunLog: (cb) => ipcRenderer.on('run:log', (_e, entry) => cb(entry)),
  onTestResult: (cb) => ipcRenderer.on('run:testResult', (_e, entry) => cb(entry)),

  generateReport: (runId) => ipcRenderer.invoke('report:generate', runId),
  getHistory: () => ipcRenderer.invoke('history:list'),
});
```

- [ ] **Step 4: Verificar que la app arranca y pide la carpeta**

Run: `npm start`
Expected: se abre la ventana y aparece un diálogo "Elige la carpeta del proyecto ERP". Elegir `electron-app/test-fixtures/sample-repo`. El árbol muestra las suites **alpha** y **General** con 5 pruebas.

Si arrancas desde la terminal integrada de VS Code, primero: `Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell). Esa variable hace que Electron arranque como Node plano.

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/ipc.js electron-app/main.js electron-app/preload.js
git commit -m "feat: cablear los handlers IPC contra Playwright real"
```

---

### Task 13: Selector de perfil en el sidebar

**Files:**
- Modify: `electron-app/renderer/index.html:76-82`
- Modify: `electron-app/renderer/styles.css` (añadir al final)
- Modify: `electron-app/renderer/renderer.js`

- [ ] **Step 1: Convertir el bloque de perfil en un selector**

En `renderer/index.html`, reemplazar el bloque `<div class="profile-row">…</div>` (líneas 76-82) por:

```html
      <div class="profile-switcher" id="profile-switcher">
        <div class="profile-menu" id="profile-menu" hidden></div>
        <div class="profile-row" id="profile-trigger">
          <div class="avatar" id="profile-avatar">··</div>
          <div class="profile-text">
            <div class="profile-name" id="profile-name">Sin perfil</div>
            <div class="profile-role" id="profile-role">Elige un perfil</div>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Estilos del menú (al final de `renderer/styles.css`)**

El menú se abre **hacia arriba**: el bloque de perfil vive pegado al fondo del sidebar.

```css
/* ---- selector de perfil de QA ---- */
.profile-switcher { position: relative; }
.profile-row { cursor: pointer; border-radius: 8px; }
.profile-row:hover { background: #f8fafc; }
.profile-menu {
  position: absolute; bottom: 100%; left: 0; right: 0; margin-bottom: 6px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 9px;
  box-shadow: 0 8px 20px rgba(15,23,42,.10);
  padding: 5px; display: flex; flex-direction: column; gap: 2px; z-index: 20;
}
.profile-menu[hidden] { display: none; }
.profile-menu-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 7px; cursor: pointer; }
.profile-menu-item:hover { background: #f8fafc; }
.profile-menu-item .label { flex: 1; font-size: 12.5px; font-weight: 600; color: #334155; }
.profile-menu-item .sub { font-size: 10.5px; color: #94a3b8; }
```

- [ ] **Step 3: Estado y render en `renderer/renderer.js`**

Añadir al objeto `state` (tras `project: 'erp',`):

```js
  profiles: [],
  profile: null,
  profileMenuOpen: false,
```

Añadir estas funciones justo después de `renderProjectSwitcher()`:

```js
function initials(name) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase() || '··';
}

async function loadProfiles() {
  state.profiles = await api.listProfiles(state.project);
  state.profile = await api.getActiveProfile(state.project);
  if (!state.profile && state.profiles.length > 0) {
    state.profile = state.profiles[0].id;
    await api.selectProfile(state.project, state.profile);
  }
  renderProfileSwitcher();
}

function renderProfileSwitcher() {
  const active = state.profiles.find((p) => p.id === state.profile);
  document.getElementById('profile-avatar').textContent = active ? initials(active.name) : '··';
  document.getElementById('profile-name').textContent = active ? active.name : 'Sin perfil';
  document.getElementById('profile-role').textContent = active ? active.role : 'Elige un perfil';

  const menu = document.getElementById('profile-menu');
  menu.hidden = !state.profileMenuOpen;
  menu.innerHTML = '';
  state.profiles.forEach((profile) => {
    const row = document.createElement('div');
    row.className = 'profile-menu-item';
    row.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="label">${profile.name}</div>
        <div class="sub">${profile.role}</div>
      </div>
      ${profile.id === state.profile ? checkSvg('#2563eb') : ''}
    `;
    row.onclick = async (e) => {
      e.stopPropagation();
      state.profile = profile.id;
      state.profileMenuOpen = false;
      await api.selectProfile(state.project, profile.id);
      renderProfileSwitcher();
    };
    menu.appendChild(row);
  });
}
```

- [ ] **Step 4: Enganchar el trigger y la carga**

En `wireSidebar()`, antes de `renderProjectSwitcher();`, añadir:

```js
  document.getElementById('profile-trigger').onclick = () => {
    state.profileMenuOpen = !state.profileMenuOpen;
    renderProfileSwitcher();
  };
```

En `init()`, después de `await loadProject(state.project);`, añadir una línea:

```js
  await loadProfiles();
```

Y en el `row.onclick` de `renderProjectSwitcher()`, tras `await loadProject(proj.id);`, añadir la misma línea, para que al cambiar de proyecto se recarguen sus perfiles:

```js
    row.onclick = async (e) => {
      e.stopPropagation();
      state.project = proj.id;
      state.projectMenuOpen = false;
      renderProjectSwitcher();
      await loadProject(proj.id);
      await loadProfiles();
      renderScreen();
    };
```

`loadProject()` no se toca.

- [ ] **Step 5: Pasar `projectId` y `runAll` al backend**

En `startRun()`, reemplazar la llamada a `api.startRun` por:

```js
  const result = await api.startRun({
    projectId: state.project,
    testIds: ids,
    runAll: state.runTarget === 'all',
    visualMode: state.runOptions.visualMode,
    generateReport: state.runOptions.generateReport,
    stopOnFail: state.runOptions.stopOnFail,
  });
```

- [ ] **Step 6: Mantener vivo el stub del navegador**

En `createBrowserStub()`, añadir dentro del objeto que devuelve:

```js
    async listProfiles() {
      return [
        { id: 'demo', name: 'María Gómez', role: 'QA Lead' },
        { id: 'otro', name: 'Julián Ríos', role: 'QA Tester' },
      ];
    },
    async getActiveProfile() { return 'demo'; },
    async selectProfile(_projectId, profileId) { return profileId; },
```

- [ ] **Step 7: Verificar en la app**

Run: `npm start`
Expected: abajo del sidebar aparece **Ana Ruiz · QA Lead** (viene de `.env.demo` del repo de juguete). Al hacer clic se despliega el menú hacia arriba con los perfiles disponibles.

Abrir también `renderer/index.html` en un navegador: debe seguir navegable, mostrando María Gómez desde el stub.

- [ ] **Step 8: Commit**

```bash
git add electron-app/renderer/index.html electron-app/renderer/styles.css electron-app/renderer/renderer.js
git commit -m "feat: selector de perfil de QA en el sidebar"
```

---

### Task 14: Empaquetado

Sin esto la app funciona en desarrollo y falla en el instalador: Playwright no puede leer dentro de `app.asar`.

**Files:**
- Modify: `electron-app/package.json`

- [ ] **Step 1: Desempaquetar el reporter**

En `package.json`, dentro de `"build"`, añadir `asarUnpack` junto a las claves existentes:

```json
  "build": {
    "appId": "com.tuempresa.qatestrunner",
    "productName": "QA Test Runner",
    "asarUnpack": ["main/playwright/ndjson-reporter.cjs"],
    "files": ["main.js", "preload.js", "main/**/*", "renderer/**/*", "mock/**/*"],
    "win": { "target": "nsis" },
    "mac": { "target": "dmg" },
    "linux": { "target": "AppImage" }
  }
```

`files` excluye `test/` y `test-fixtures/` del instalador: el repo de juguete pesa decenas de megas y no tiene nada que hacer en producción.

- [ ] **Step 2: Verificar que el instalador se construye**

Run: `npm run dist`
Expected: termina sin error y genera `dist/`. Comprobar que existe
`dist/win-unpacked/resources/app.asar.unpacked/main/playwright/ndjson-reporter.cjs`.

- [ ] **Step 3: Commit**

```bash
git add electron-app/package.json
git commit -m "build: desempaquetar el reporter y excluir las pruebas del instalador"
```

---

### Task 15: Verificación de punta a punta

- [ ] **Step 1: La suite completa pasa**

Run: `npm test`
Expected: `# pass 43`, `# fail 0`

- [ ] **Step 2: El bucle central funciona contra el repo de juguete**

Run: `npm start`

1. Elegir `electron-app/test-fixtures/sample-repo` cuando pida la carpeta.
2. El árbol muestra **alpha** (mixed 3, ok 1) y **General** (slow 1).
3. Seleccionar las dos pruebas de `alpha/ok.spec.ts` y `alpha/mixed.spec.ts`.
4. "Ejecutar seleccionados" → confirmar en el modal "Iniciar ejecución".
5. La pantalla salta a *Ejecución en vivo*: las pruebas se marcan en curso y luego pasan a verde o rojo. `falla a propósito` sale en rojo con su mensaje. `omitida` deja una línea gris.
6. Volver a ejecutar y pulsar "Detener": la corrida se corta y no queda ningún `node.exe` ni `electron.exe` huérfano (`tasklist | findstr playwright`).

- [ ] **Step 3: El árbol real del ERP se lista (sin ejecutar nada)**

Borrar la ruta guardada para forzar el diálogo:

```bash
node -e "const p=require('path'),f=require('fs');const c=p.join(process.env.APPDATA,'qa-test-runner','config.json');f.existsSync(c)&&f.unlinkSync(c)"
```

Run: `npm start`, elegir `C:\Users\usuario\Desktop\Rasi\rasierp-e2e\rasierp-e2e`.

Expected: el árbol muestra las suites `cartera`, `comun`, `cuentas-por-pagar`, `General`, `tesoreria`, `ventas` con **50 pruebas** en total, y el perfil del sidebar ofrece `nelson` y `Nelson_vid`.

**No ejecutar ninguna prueba de ese repo:** corre contra el ERP en producción.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "feat: rebanada 1 del backend — listar y ejecutar pruebas reales"
```

---

## Fuera de alcance

Siguen simulados en `main/ipc.js`, cada uno con su propio spec más adelante:
`sync:checkStatus`, `sync:update`, `report:generate`, `history:list`, clonar por
URL, el token cifrado y la pantalla de configuración.
