# Perfiles de QA editables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el QA cree y edite su perfil (el `.env`) desde un formulario en la app, guardado cifrado fuera del clon y materializado en claro dentro del clon solo mientras hace falta.

**Architecture:** Cuatro módulos nuevos bajo `main/profiles/` con dependencias inyectadas, como el resto de `main/`. El `.env.example` del repo se lee como esquema del formulario; el perfil maestro se guarda cifrado con `safeStorage` en la carpeta de datos; una copia en claro se escribe en el clon al ejecutar y se barre al cerrar/arrancar. El `playwright.config.ts` del repo no se toca: ya consume `.env.<perfil>`.

**Tech Stack:** Electron 30 (`safeStorage`, `app`), Node 20, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-07-17-perfiles-env-editables-design.md`

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `main/profiles/schema.js` (crear) | `parseEnvExample(text)` → campos del formulario. Puro. |
| `main/profiles/store.js` (crear) | Copia maestra cifrada, un archivo por perfil. |
| `main/profiles/materialize.js` (crear) | Escribir/barrer el `.env.<id>` en el clon. |
| `main/profiles.js` (modificar) | `listProfiles`/`readVisibleKeys` fuera; entra `readSchema`. |
| `main/ipc.js` (modificar) | Handlers `profiles:*` contra el store + ciclo de vida. |
| `preload.js` (modificar) | Exponer `getProfileSchema`/`saveProfile`/`removeProfile`. |
| `renderer/renderer.js` (modificar) | Formulario de perfil + stub de navegador. |
| `test/profiles.test.js` (reescribir) | Deja de probar `listProfiles`; prueba `readSchema`. |

**Nota de migración:** `readVisibleKeys` solo se usa dentro de `profiles.js` (verificado). `listProfiles` lo consumen `ipc.js` y el renderer vía el canal IPC `profiles:list`; el canal se conserva, cambia su implementación (Task 5). Los 8 tests actuales de `profiles.test.js` prueban `listProfiles` leyendo del repo —comportamiento que se elimina— así que se reemplazan (Task 4).

---

### Task 1: `schema.js` — el `.env.example` como esquema

**Files:**
- Create: `electron-app/main/profiles/schema.js`
- Test: `electron-app/test/schema.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Crea `test/schema.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnvExample } = require('../main/profiles/schema');

test('cada CLAVE=valor es un campo con su valor por defecto', () => {
  const fields = parseEnvExample('TEST_USERNAME=tu_usuario\nQA_CARGO=QA Tester\n');
  assert.deepEqual(fields, [
    { key: 'TEST_USERNAME', value: 'tu_usuario', help: '' },
    { key: 'QA_CARGO', value: 'QA Tester', help: '' },
  ]);
});

test('acepta claves con dígitos (N8N_WEBHOOK_URL, GOOGLE_TEMPLATE_DOC_ID)', () => {
  const fields = parseEnvExample('N8N_WEBHOOK_URL=https://x\nGOOGLE_TEMPLATE_DOC_ID=abc123\n');
  assert.deepEqual(fields.map((f) => f.key), ['N8N_WEBHOOK_URL', 'GOOGLE_TEMPLATE_DOC_ID']);
});

test('los comentarios de arriba se vuelven la ayuda del campo', () => {
  const fields = parseEnvExample('# Nombre completo del profesional\nPROFESIONAL_NOMBRE=Nombre Apellido\n');
  assert.equal(fields[0].help, 'Nombre completo del profesional');
});

test('varias líneas de comentario se unen', () => {
  const fields = parseEnvExample('# Documento del paciente\n# vinculado al profesional\nPACIENTE_DOCUMENTO=00998877\n');
  assert.equal(fields[0].help, 'Documento del paciente vinculado al profesional');
});

test('un separador decorativo no genera campo ni contamina la ayuda del siguiente', () => {
  const fields = parseEnvExample('# ─── Horas por módulo ───\nATOD_HORA=07:00\n');
  assert.equal(fields.length, 1);
  assert.equal(fields[0].key, 'ATOD_HORA');
  assert.equal(fields[0].help, '');
});

test('una línea en blanco corta la ayuda: no se arrastra a un campo lejano', () => {
  const fields = parseEnvExample('# comentario suelto\n\nBASE_URL=https://x\n');
  assert.equal(fields[0].help, '');
});

test('un valor vacío es un campo válido', () => {
  const fields = parseEnvExample('ATENCION_HORA=\n');
  assert.deepEqual(fields, [{ key: 'ATENCION_HORA', value: '', help: '' }]);
});

test('un valor con = dentro (URL con query) se conserva entero', () => {
  const fields = parseEnvExample('BASE_URL=https://x/?a=1&b=2\n');
  assert.equal(fields[0].value, 'https://x/?a=1&b=2');
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/schema.test.js`
Expected: FAIL — `Cannot find module '../main/profiles/schema'`

- [ ] **Step 3: Implementa**

Crea `main/profiles/schema.js`:

```js
/**
 * Convierte el `.env.example` del repo en la lista de campos del formulario.
 * El repo ya documenta cada clave ahí, así que la app no codifica ningún nombre
 * de clave de este proyecto: sirve para cualquier repo con un `.env.example`.
 */

// Clave de entorno: empieza por letra/_ y admite dígitos (N8N_WEBHOOK_URL).
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
// Separador decorativo: un comentario sin letras ni dígitos (# ─── ... ───).
const DECORATIVE = /^#[^A-Za-z0-9]*$/;

function parseEnvExample(text) {
  const fields = [];
  let help = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') { help = []; continue; }           // el blanco corta la ayuda
    if (line.startsWith('#')) {
      if (!DECORATIVE.test(line)) help.push(line.replace(/^#\s?/, '').trim());
      continue;
    }
    const match = line.match(ASSIGNMENT);
    if (!match) { help = []; continue; }
    fields.push({ key: match[1], value: match[2], help: help.join(' ') });
    help = [];
  }
  return fields;
}

module.exports = { parseEnvExample };
```

- [ ] **Step 4: Corre los tests**

Run: `cd electron-app && node --test test/schema.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/profiles/schema.js electron-app/test/schema.test.js
git commit -m "feat(profiles): leer el .env.example como esquema del formulario"
```

---

### Task 2: `store.js` — la copia maestra cifrada

**Files:**
- Create: `electron-app/main/profiles/store.js`
- Test: `electron-app/test/profile-store.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Crea `test/profile-store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProfileStore } = require('../main/profiles/store');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-pstore-'));

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (value) => Buffer.from(`cif:${value}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^cif:/, ''),
});

const values = { QA_NOMBRE: 'Ana Ruiz', QA_CARGO: 'QA Lead', TEST_PASSWORD: 'secreta-NUNCA' };

test('guarda y recupera un perfil', () => {
  const dir = tempDir();
  createProfileStore({ dir, safeStorage: fakeSafeStorage() }).save('erp', 'ana-ruiz', values);
  const loaded = createProfileStore({ dir, safeStorage: fakeSafeStorage() }).load('erp', 'ana-ruiz');
  assert.deepEqual(loaded, values);
});

test('la contraseña no queda en claro en el archivo', () => {
  const dir = tempDir();
  createProfileStore({ dir, safeStorage: fakeSafeStorage() }).save('erp', 'ana-ruiz', values);
  const file = path.join(dir, 'erp', 'ana-ruiz.enc');
  assert.equal(fs.readFileSync(file, 'utf8').includes('secreta-NUNCA'), false);
});

test('list devuelve id, nombre y cargo sin la contraseña', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage() });
  store.save('erp', 'ana-ruiz', values);
  store.save('erp', 'beto-paz', { QA_NOMBRE: 'Beto Paz', QA_CARGO: 'QA Tester' });
  const list = store.list('erp');
  assert.deepEqual(list, [
    { id: 'ana-ruiz', name: 'Ana Ruiz', role: 'QA Lead' },
    { id: 'beto-paz', name: 'Beto Paz', role: 'QA Tester' },
  ]);
  assert.equal(JSON.stringify(list).includes('secreta'), false);
});

test('list de un proyecto sin perfiles devuelve []', () => {
  assert.deepEqual(createProfileStore({ dir: tempDir(), safeStorage: fakeSafeStorage() }).list('erp'), []);
});

test('los perfiles de un proyecto no se mezclan con los de otro', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage() });
  store.save('erp', 'ana-ruiz', values);
  assert.deepEqual(store.list('medical'), []);
});

test('sin cifrado disponible lanza y no escribe nada', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage(false) });
  assert.throws(() => store.save('erp', 'ana-ruiz', values), (err) => err.code === 'SECURE_STORAGE_UNAVAILABLE');
  assert.equal(fs.existsSync(path.join(dir, 'erp')), false);
});

test('un perfil ilegible se ignora, no rompe list', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage() });
  store.save('erp', 'ana-ruiz', values);
  const roto = { ...fakeSafeStorage(), decryptString: () => { throw new Error('otra cuenta'); } };
  assert.deepEqual(createProfileStore({ dir, safeStorage: roto }).list('erp'), []);
  assert.equal(createProfileStore({ dir, safeStorage: roto }).load('erp', 'ana-ruiz'), null);
});

test('remove borra el perfil', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage() });
  store.save('erp', 'ana-ruiz', values);
  store.remove('erp', 'ana-ruiz');
  assert.equal(store.load('erp', 'ana-ruiz'), null);
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/profile-store.test.js`
Expected: FAIL — `Cannot find module '../main/profiles/store'`

- [ ] **Step 3: Implementa**

Crea `main/profiles/store.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { appError } = require('../errors');

/**
 * Copia maestra del perfil, un archivo por perfil bajo `dir/<proyecto>/<id>.enc`,
 * cifrado con safeStorage (DPAPI en Windows). Vive fuera del clon, así que
 * sobrevive a reclonados. Guarda el objeto de valores del formulario tal cual;
 * el nombre y el cargo se leen de las claves QA_NOMBRE/QA_CARGO para el sidebar.
 */
function createProfileStore({ dir, safeStorage }) {
  const projectDir = (projectId) => path.join(dir, projectId);
  const file = (projectId, id) => path.join(projectDir(projectId), `${id}.enc`);

  function readValues(projectId, id) {
    try {
      const buffer = fs.readFileSync(file(projectId, id));
      return JSON.parse(safeStorage.decryptString(buffer));
    } catch {
      return null; // no existe, o cifrado por otra cuenta de Windows
    }
  }

  return {
    save(projectId, id, values) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw appError('SECURE_STORAGE_UNAVAILABLE', 'Este equipo no puede guardar tu perfil de forma segura.');
      }
      fs.mkdirSync(projectDir(projectId), { recursive: true });
      fs.writeFileSync(file(projectId, id), safeStorage.encryptString(JSON.stringify(values)));
    },

    load(projectId, id) {
      return readValues(projectId, id);
    },

    list(projectId) {
      let names;
      try { names = fs.readdirSync(projectDir(projectId)); }
      catch { return []; }
      return names
        .filter((n) => n.endsWith('.enc'))
        .map((n) => {
          const id = n.slice(0, -'.enc'.length);
          const values = readValues(projectId, id);
          return values ? { id, name: values.QA_NOMBRE || id, role: values.QA_CARGO || 'QA' } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },

    remove(projectId, id) {
      fs.rmSync(file(projectId, id), { force: true });
    },
  };
}

module.exports = { createProfileStore };
```

- [ ] **Step 4: Corre los tests**

Run: `cd electron-app && node --test test/profile-store.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/profiles/store.js electron-app/test/profile-store.test.js
git commit -m "feat(profiles): copia maestra cifrada del perfil fuera del clon"
```

---

### Task 3: `materialize.js` — el puente al clon

**Files:**
- Create: `electron-app/main/profiles/materialize.js`
- Test: `electron-app/test/materialize.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Crea `test/materialize.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeEnv, sweep } = require('../main/profiles/materialize');

const repoDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-mat-'));

test('writeEnv escribe .env.<id> con las claves del perfil', () => {
  const repo = repoDir();
  writeEnv({ repoPath: repo, id: 'ana', values: { TEST_USERNAME: 'ana', TEST_PASSWORD: 'x' } });
  const content = fs.readFileSync(path.join(repo, '.env.ana'), 'utf8');
  assert.match(content, /^TEST_USERNAME=ana$/m);
  assert.match(content, /^TEST_PASSWORD=x$/m);
});

test('sweep borra los .env.* materializados', () => {
  const repo = repoDir();
  fs.writeFileSync(path.join(repo, '.env.ana'), 'x');
  fs.writeFileSync(path.join(repo, '.env.beto'), 'x');
  sweep(repo);
  assert.equal(fs.existsSync(path.join(repo, '.env.ana')), false);
  assert.equal(fs.existsSync(path.join(repo, '.env.beto')), false);
});

test('sweep NUNCA borra .env.example', () => {
  const repo = repoDir();
  fs.writeFileSync(path.join(repo, '.env.example'), 'plantilla');
  fs.writeFileSync(path.join(repo, '.env.ana'), 'x');
  sweep(repo);
  assert.equal(fs.existsSync(path.join(repo, '.env.example')), true);
  assert.equal(fs.existsSync(path.join(repo, '.env.ana')), false);
});

test('sweep no toca archivos que no son .env.*', () => {
  const repo = repoDir();
  fs.writeFileSync(path.join(repo, 'package.json'), '{}');
  fs.writeFileSync(path.join(repo, '.env'), 'base'); // .env pelado, sin sufijo
  sweep(repo);
  assert.equal(fs.existsSync(path.join(repo, 'package.json')), true);
  assert.equal(fs.existsSync(path.join(repo, '.env')), true);
});

test('sweep sobre una carpeta sin .env.* no falla', () => {
  assert.doesNotThrow(() => sweep(repoDir()));
});

test('sweep sobre una carpeta inexistente no falla', () => {
  assert.doesNotThrow(() => sweep(path.join(os.tmpdir(), 'no-existe-qatr')));
});

test('lo que escribe writeEnv lo puede releer un parser de env', () => {
  const repo = repoDir();
  writeEnv({ repoPath: repo, id: 'ana', values: { BASE_URL: 'https://x/?a=1&b=2', VACIO: '' } });
  const parsed = {};
  for (const line of fs.readFileSync(path.join(repo, '.env.ana'), 'utf8').split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) parsed[line.slice(0, eq)] = line.slice(eq + 1);
  }
  assert.equal(parsed.BASE_URL, 'https://x/?a=1&b=2');
  assert.equal(parsed.VACIO, '');
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/materialize.test.js`
Expected: FAIL — `Cannot find module '../main/profiles/materialize'`

- [ ] **Step 3: Implementa**

Crea `main/profiles/materialize.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

/** Sufijo de perfil, p. ej. `.env.ana`. `.env.example` queda excluido a propósito. */
const MATERIALIZED = /^\.env\.(?!example$).+/;

/** Escribe el `.env.<id>` en claro en la raíz del clon, para que Playwright lo lea. */
function writeEnv({ repoPath, id, values }) {
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(path.join(repoPath, `.env.${id}`), body, 'utf8');
}

/**
 * Borra los `.env.*` materializados de la raíz del clon, menos `.env.example`
 * (commiteado, no es nuestro, y es la fuente del esquema). Es la aserción de
 * seguridad central: un sweep que borre el ejemplo rompe el repo del QA.
 */
function sweep(repoPath) {
  let names;
  try { names = fs.readdirSync(repoPath); }
  catch { return; }
  for (const name of names) {
    if (MATERIALIZED.test(name)) fs.rmSync(path.join(repoPath, name), { force: true });
  }
}

module.exports = { writeEnv, sweep };
```

- [ ] **Step 4: Corre los tests**

Run: `cd electron-app && node --test test/materialize.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/profiles/materialize.js electron-app/test/materialize.test.js
git commit -m "feat(profiles): materializar y barrer el .env efímero del clon"
```

---

### Task 4: `profiles.js` cambia de fuente

**Files:**
- Modify: `electron-app/main/profiles.js`
- Test: `electron-app/test/profiles.test.js` (reescribir por completo)

- [ ] **Step 1: Reescribe el test**

`listProfiles`/`readVisibleKeys` dejan de existir; su comportamiento (leer perfiles del repo) se elimina. Reemplaza **todo** el contenido de `test/profiles.test.js` por:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSchema } = require('../main/profiles');

function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-profiles-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

test('readSchema devuelve los campos del .env.example', () => {
  const dir = repoWith({ '.env.example': 'TEST_USERNAME=tu_usuario\nQA_CARGO=QA Tester\n' });
  assert.deepEqual(readSchema(dir), [
    { key: 'TEST_USERNAME', value: 'tu_usuario', help: '' },
    { key: 'QA_CARGO', value: 'QA Tester', help: '' },
  ]);
});

test('sin .env.example lanza PROFILE_TEMPLATE_MISSING', () => {
  const dir = repoWith({ 'package.json': '{}' });
  assert.throws(() => readSchema(dir), (err) => err.code === 'PROFILE_TEMPLATE_MISSING');
});
```

- [ ] **Step 2: Corre el test para verificar que falla**

Run: `cd electron-app && node --test test/profiles.test.js`
Expected: FAIL — `readSchema is not a function` (todavía exporta `listProfiles`)

- [ ] **Step 3: Reemplaza `profiles.js`**

Reemplaza **todo** el contenido de `main/profiles.js` por:

```js
const fs = require('node:fs');
const path = require('node:path');
const { appError } = require('./errors');
const { parseEnvExample } = require('./profiles/schema');

/**
 * Lee el `.env.example` del clon y lo devuelve como esquema del formulario de
 * perfil. Es la plantilla que el repo declara; la app no codifica sus claves.
 */
function readSchema(repoPath) {
  let text;
  try {
    text = fs.readFileSync(path.join(repoPath, '.env.example'), 'utf8');
  } catch {
    throw appError('PROFILE_TEMPLATE_MISSING', 'Este proyecto no trae la plantilla de configuración. Avisa al responsable.');
  }
  return parseEnvExample(text);
}

module.exports = { readSchema };
```

- [ ] **Step 4: Corre el test**

Run: `cd electron-app && node --test test/profiles.test.js`
Expected: PASS (2 tests)

**Nota:** la suite completa (`npm test`) fallará aquí porque `ipc.js` todavía importa `listProfiles`. Es esperado; se arregla en Task 5, que es la que vuelve a dejar verde el conjunto. No "arregles" `ipc.js` en esta task.

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/profiles.js electron-app/test/profiles.test.js
git commit -m "feat(profiles): profiles.js lee el esquema en vez de listar perfiles del repo"
```

---

### Task 5: IPC contra el store + ciclo de vida

**Files:**
- Modify: `electron-app/main/ipc.js`
- Modify: `electron-app/preload.js`

Sin test automático: `ipc.js` importa `electron` y la suite corre en Node pelado. La lógica de abajo ya está probada (Tasks 1-4). Verificación manual en Step 6. Al terminar esta task, `npm test` vuelve a 100% (arregla la rotura que dejó Task 4).

- [ ] **Step 1: Imports en `ipc.js`**

En `main/ipc.js`, reemplaza la línea 7 (`const { listProfiles } = require('./profiles');`) por:

```js
const { readSchema } = require('./profiles');
const { createProfileStore } = require('./profiles/store');
const { writeEnv, sweep } = require('./profiles/materialize');
const { uniqueProjectId } = require('./projects');
```

`safeStorage` y `app` ya se importan de `electron` en la línea 3 (los añadió la rebanada de GitHub). Verifícalo; si `safeStorage` no estuviera, añádelo a ese `require`.

- [ ] **Step 2: Construye el store y el barrido inicial**

Dentro de `registerIpc`, junto a la creación de `account`/`auth`/`projects` (sobre la línea `let currentRun = null;`), añade:

```js
  const profileStore = createProfileStore({ dir: path.join(userData, 'perfiles'), safeStorage });

  /** Escribe en el clon el .env del perfil activo del proyecto (o solo barre si no hay). */
  function materializeActive(projectId) {
    const project = store.getProject(projectId);
    if (!project.repoPath || !fs.existsSync(project.repoPath)) return;
    sweep(project.repoPath);
    const values = project.profile ? profileStore.load(projectId, project.profile) : null;
    if (values) writeEnv({ repoPath: project.repoPath, id: project.profile, values });
  }

  /** Al arrancar y al cerrar: barre restos de .env en claro de todos los clones. */
  function sweepAll() {
    for (const project of store.listProjects()) {
      if (project.repoPath && fs.existsSync(project.repoPath)) sweep(project.repoPath);
    }
  }

  sweepAll();                         // limpia restos de una sesión que murió mal
  app.on('before-quit', sweepAll);    // limpia al salir
```

- [ ] **Step 3: Reemplaza el bloque de perfiles**

Sustituye el bloque `/* ---------- perfiles ---------- */` entero (los tres handlers `profiles:list`, `profiles:active`, `profiles:select`) por:

```js
  /* ---------- perfiles ---------- */
  ipcMain.handle('profiles:list', (_event, projectId) => profileStore.list(projectId));

  ipcMain.handle('profiles:schema', async (_event, projectId) => {
    try {
      return { ok: true, fields: readSchema(await ensureRepoPath(projectId)) };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    }
  });

  ipcMain.handle('profiles:save', (_event, projectId, id, values) => {
    try {
      const finalId = id || uniqueProjectId(values.QA_NOMBRE || 'perfil', new Set(profileStore.list(projectId).map((p) => p.id)));
      profileStore.save(projectId, finalId, values);
      store.setProject(projectId, { profile: finalId });
      materializeActive(projectId);
      return { ok: true, profile: { id: finalId, name: values.QA_NOMBRE || finalId, role: values.QA_CARGO || 'QA' } };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    }
  });

  ipcMain.handle('profiles:active', (_event, projectId) => store.getProject(projectId).profile || null);

  ipcMain.handle('profiles:select', (_event, projectId, profileId) => {
    store.setProject(projectId, { profile: profileId });
    materializeActive(projectId);
    return profileId;
  });
```

- [ ] **Step 4: Materializa antes de ejecutar**

En el handler `run:start`, tras obtener `repoPath` y antes de crear `currentRun`, añade una línea que garantiza que el `.env` está fresco en el momento que importa:

```js
      const repoPath = await ensureRepoPath(projectId);
      materializeActive(projectId);   // asegura el .env del perfil activo antes de correr
```

(La línea `const repoPath = ...` ya existe; añade solo la segunda.)

- [ ] **Step 5: Puente en `preload.js`**

En `preload.js`, el bloque de perfiles ya tiene `listProfiles`, `getActiveProfile`, `selectProfile`. Añade dentro de él:

```js
  getProfileSchema: (projectId) => ipcRenderer.invoke('profiles:schema', projectId),
  saveProfile: (projectId, id, values) => ipcRenderer.invoke('profiles:save', projectId, id, values),
```

- [ ] **Step 6: Verifica**

Run: `cd electron-app && npm test`
Expected: PASS — toda la suite vuelve a verde (la rotura de Task 4 queda resuelta al no importar ya `listProfiles`).

Luego levanta la app y confirma que arranca sin errores en consola:

Run: `cd electron-app && env -u ELECTRON_RUN_AS_NODE npm start`
(`ELECTRON_RUN_AS_NODE` viene puesto por la terminal de VS Code y hace que Electron corra como Node pelado, petando en `app.whenReady`; por eso se desactiva. Lánzala en segundo plano, confirma varios `electron.exe` vivos con `tasklist //FI "IMAGENAME eq electron.exe"`, y ciérrala al terminar para no dejar ventanas.)

- [ ] **Step 7: Commit**

```bash
git add electron-app/main/ipc.js electron-app/preload.js
git commit -m "feat(profiles): IPC contra el store cifrado y ciclo de vida del .env"
```

---

### Task 6: Renderer — el formulario de perfil

**Files:**
- Modify: `electron-app/renderer/renderer.js`

Sin test automático (el renderer no tiene suite). Verificación manual en Step 5.

- [ ] **Step 1: El formulario**

Añade junto a `openProjectModal()` en `renderer.js`:

```js
/** Campos cuyo valor se enmascara. Heurística genérica, no específica del repo. */
const SECRET_KEY = /(PASSWORD|TOKEN|SECRET)/i;

async function openProfileModal() {
  const schema = await api.getProfileSchema(state.project);
  if (!schema.ok) { showError(schema.error); return; }
  const fields = schema.fields;

  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:560px;max-height:82vh;display:flex;flex-direction:column">
    <div class="modal-pad" style="overflow:auto">
      <div class="modal-title">Crea tu perfil para este proyecto</div>
      <div class="modal-sub">La app necesita tus datos para ejecutar las pruebas con tu usuario.</div>
      <div id="profile-fields" style="margin-top:16px">
        ${fields.map((f, i) => `
          <label style="display:block;margin-top:12px;font-size:12px;font-weight:700">${f.key}</label>
          <input id="pf-${i}" type="${SECRET_KEY.test(f.key) ? 'password' : 'text'}"
                 value="${String(f.value).replace(/"/g, '&quot;')}"
                 style="width:100%;margin-top:6px;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
          ${f.help ? `<div style="margin-top:4px;font-size:11px;color:#94a3b8">${f.help}</div>` : ''}
        `).join('')}
      </div>
      <div id="profile-error" style="display:none;margin-top:12px;color:#b91c1c;font-size:12px"></div>
    </div>
    <div class="modal-actions" style="padding:14px 20px;border-top:1px solid #eef2f7">
      <button class="btn btn-secondary" id="profile-cancel">Cancelar</button>
      <button class="btn btn-primary" id="profile-save">Guardar perfil</button>
    </div>
  </div>`;

  document.getElementById('profile-cancel').onclick = () => closeModal();
  document.getElementById('profile-save').onclick = async () => {
    const values = {};
    fields.forEach((f, i) => { values[f.key] = document.getElementById(`pf-${i}`).value; });
    const result = await api.saveProfile(state.project, null, values);
    if (!result.ok) {
      const err = document.getElementById('profile-error');
      err.textContent = result.error || 'No fue posible guardar el perfil.';
      err.style.display = 'block';
      return;
    }
    closeModal();
    await loadProfiles();
    renderScreen();
  };
}
```

- [ ] **Step 2: Ofrecer el formulario cuando no hay perfil**

`loadProfiles()` (renderer.js ~línea 197) hoy asume que hay perfiles. Reemplázala por:

```js
async function loadProfiles() {
  state.profiles = await api.listProfiles(state.project);
  state.profile = await api.getActiveProfile(state.project);
  if (!state.profile && state.profiles.length > 0) {
    state.profile = state.profiles[0].id;
    await api.selectProfile(state.project, state.profile);
  }
  renderProfileSwitcher();
}
```

(Si ya es idéntica, déjala. El cambio de comportamiento vive en `renderScreen`, Step 3.)

- [ ] **Step 3: La pantalla del proyecto invita a crear**

En `renderScreen()`, al principio, cuando hay proyecto pero no hay perfil activo, muestra la invitación en vez de la pantalla normal. Añade como primera comprobación tras confirmar que hay proyecto:

```js
  if (state.project && state.profiles.length === 0) {
    $main.innerHTML = `<div class="screen" style="display:grid;place-items:center;text-align:center;padding:40px">
      <div style="max-width:460px">
        <div class="screen-title">Crea tu perfil para este proyecto</div>
        <div class="screen-subtitle" style="margin:10px 0 22px">Necesitamos tu usuario y tus datos para ejecutar las pruebas con tu cuenta.</div>
        <button class="btn btn-primary" id="btn-create-profile">Crear perfil</button>
      </div></div>`;
    document.getElementById('btn-create-profile').onclick = () => openProfileModal();
    return;
  }
```

Localiza el punto exacto: justo después de la guarda que hoy maneja "sin proyecto" en `renderScreen`. Si `renderScreen` no tiene esa forma, colócalo como primera línea del cuerpo tras las guardas de proyecto existentes.

- [ ] **Step 4: "Añadir perfil" en el menú y el stub**

En `renderProfileSwitcher()`, junto a la fila de la cuenta de GitHub del menú, añade una fila de "Añadir perfil" (tras el `separator`, antes de `githubRow`):

```js
  const addRow = document.createElement('div');
  addRow.className = 'profile-menu-item';
  addRow.innerHTML = `<div style="flex:1;min-width:0;"><div class="label">Añadir perfil</div><div class="sub">Otro usuario para este proyecto</div></div>`;
  addRow.onclick = (e) => { e.stopPropagation(); state.profileMenuOpen = false; openProfileModal(); };
  menu.appendChild(addRow);
```

En `createBrowserStub()`, junto a las funciones de perfil, añade:

```js
    async getProfileSchema() { return { ok: true, fields: [
      { key: 'TEST_USERNAME', value: 'demo', help: 'Tu usuario del ERP' },
      { key: 'TEST_PASSWORD', value: '', help: '' },
    ] }; },
    async saveProfile(_p, _id, values) { return { ok: true, profile: { id: 'demo', name: values.QA_NOMBRE || 'Demo', role: values.QA_CARGO || 'QA' } }; },
```

- [ ] **Step 5: Verifica a mano**

Run: `cd electron-app && env -u ELECTRON_RUN_AS_NODE npm start`

Con un proyecto sin perfil (borra `%APPDATA%/runqa/perfiles` para simularlo): la pantalla muestra "Crea tu perfil", no el error `NO_PROFILE`. Pulsar "Crear perfil" abre el formulario con un campo por clave del `.env.example`. Guardar deja el perfil en el sidebar y materializa el `.env.<id>` en el clon. Ciérrala y comprueba que el `.env.<id>` desaparece del clon pero el `.enc` cifrado permanece en `%APPDATA%/runqa/perfiles`.

- [ ] **Step 6: Commit**

```bash
git add electron-app/renderer/renderer.js
git commit -m "feat(renderer): formulario para crear y editar el perfil de QA"
```

---

## Verificación end-to-end (manual, con la app)

1. Proyecto recién traído, sin perfil: sale el formulario, no el error `NO_PROFILE`.
2. Rellenar y guardar: el perfil aparece en el sidebar; existe `.env.<id>` en el clon; ejecutar una prueba usa esos valores.
3. Cerrar la app: `.env.<id>` desaparece del clon; el `.enc` cifrado permanece.
4. Reabrir: el perfil sigue; el `.env` se regenera al ejecutar.
5. Matar la app a la fuerza (deja el `.env` huérfano) y reabrir: el barrido al arranque lo limpia.
6. Añadir un segundo perfil y alternar en el menú: el `.env.<id>` del clon cambia con la selección.
7. El `.enc` del perfil no contiene la contraseña en claro.

## Notas sobre decisiones del plan

- **`materializeActive` es la pieza autoritativa**, y se llama en tres sitios: al seleccionar perfil, al guardar, y —lo más importante— en `run:start` justo antes de lanzar Playwright. Ese último es el que garantiza que el `.env` esté fresco en el único momento que un consumidor lo lee, sin depender del orden de llamadas del renderer.
- **El barrido usa `store.listProjects()`** para saber qué clones limpiar; solo toca rutas bajo el `projectsDir` administrado, porque esos `repoPath` los generó `projects.js`. No barre carpetas arbitrarias.
- **`profiles:save` recibe `id` para dejar abierta la edición futura**, pero el renderer siempre pasa `null` en esta rebanada: `id === null` calcula el slug con `uniqueProjectId` y crea. No hay flujo de editar un perfil existente ni de borrarlo desde la UI —el spec del renderer solo pide crear y añadir—, así que no se construyen. `store.remove` existe y está probado (Task 2) para cuando haga falta, pero sin handler IPC ni botón: añadirlos es una rebanada aparte, y borrar exigiría además decidir si se expone la contraseña descifrada al renderer.
