# RunQA cliente ↔ backend: login e ingesta — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que RunQA autentique al QA contra el backend `qa-reports`, mantenga la sesión cifrada y offline, y envíe **toda** corrida terminada al backend por una cola durable que reintenta en segundo plano.

**Architecture:** Cuatro módulos pequeños y testeables en `main/server/` (`session`, `client`, `queue`, `sender`), siguiendo el patrón del repo (dependencias inyectadas, sin acoplar a Electron, testeados con `node:test` y directorios temporales). Encima, wiring delgado en `ipc.js`/`preload.js` y una pantalla de login en el renderer. Es la mitad "cliente" del spec `2026-07-24-backend-identidad-e-ingesta-design.md`; la mitad backend ya está implementada.

**Tech Stack:** Electron (main + preload + renderer vanilla JS), `node:test`, `safeStorage`, `fetch` global de Node.

## Global Constraints

- Repositorio: `/home/nrosas@corp.rasi.com.co/Escritorio/Proyectos /TestQA/Qa_test_ejec/electron-app`. Todos los comandos desde ahí.
- Suite: `npm test` (`node --test "test/*.test.js"`). **Estado base: 197/197 en verde.** Ninguna tarea puede dejar tests en rojo.
- **NO se commitea.** El working tree ya trae mucho WIP sin commitear (features del 23 y 24 de julio, incluido eliminar-repositorio). Igual que en los planes hermanos de RunQA: trabajar sobre el working tree y verificar con `npm test` + snapshots antes/después (`node --check` para los archivos sin tests). El commit lo decide el usuario aparte.
- El backend expone (ya implementado): `POST /api/auth/login` → `{ success, data: { token, username, fullName, role, type } }`; `POST /api/runs` (JWT, 200 si crea / 204 si ya existía); `POST /api/sync/modules` (JWT). Todas las respuestas envueltas en `{ success, message, data }`. El token es un JWT cuyo payload trae `exp` (segundos epoch).
- Patrones a imitar: `main/github/account.js` (cifrado con `safeStorage` vía `store.setSetting/getSetting`), `main/results/notify-n8n.js` (`fetchImpl` inyectable, no lanza), `main/results/store.js` (store en disco testeable con dir temporal).
- **URL del servidor:** ajuste **global** (no por proyecto), en `config-store` con `setSetting('serverUrl', …)`. Valor por defecto compilado: `http://localhost:8080` (editable en Configuración, fuera de alcance de este plan salvo el handler que lo lee/escribe).

## File Structure

Nuevos (con test):
- `main/server/session.js` — sesión (JWT + usuario) cifrada; `save/load/clear/isExpired`.
- `main/server/client.js` — HTTP: `login/postRun/syncModules`; `fetchImpl` inyectable; no lanza.
- `main/server/queue.js` — cola durable en disco (`outbox/<runId>.json`); `enqueue/list/remove/setDiscarded`, tope de tamaño.
- `main/server/sender.js` — worker que drena la cola con reintentos.
- `test/server-session.test.js`, `test/server-client.test.js`, `test/server-queue.test.js`, `test/server-sender.test.js`.

Modificados (sin test unitario; `node --check` + smoke):
- `main/ipc.js` — instanciar los módulos; handlers `auth:*` y `config:server*`; encolar en `run:start`; `syncModules` tras `tests:getTree`; arrancar el sender.
- `preload.js` — wrappers.
- `renderer/renderer.js` — pantalla de login que bloquea el uso sin sesión; indicador de pendientes de envío; stubs offline.

---

### Task 1: `session.js` — sesión cifrada (TDD)

**Files:**
- Create: `main/server/session.js`
- Test: `test/server-session.test.js`

**Interfaces:**
- Produces: `createServerSession({ store, safeStorage })` → `{ save(token, user), load(), clear(), isExpired(token?) }`.
  - `save(token, user)`: cifra el token con `safeStorage`, guarda `user` en claro, bajo `setSetting('serverSession', …)`.
  - `load()`: `{ token, user, expiresAt }` o `null` (sin sesión, cifrado de otra cuenta, o corrupto).
  - `isExpired(token)`: `true` si el `exp` del JWT ya pasó; si no se puede leer el `exp`, `true` (conservador).

- [ ] **Step 1: Escribir el test que falla**

`test/server-session.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServerSession } = require('../main/server/session');

// Store en memoria que imita config-store (getSetting/setSetting).
function fakeStore() {
  const data = {};
  return {
    getSetting: (k) => data[k],
    setSetting: (k, v) => { if (v === null || v === undefined) delete data[k]; else data[k] = v; },
  };
}
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (v) => Buffer.from(`cif:${v}`, 'utf8'),
  decryptString: (b) => b.toString('utf8').replace(/^cif:/, ''),
});

// JWT de juguete: header.payload.firma, payload base64url con { exp }.
function jwtWithExp(expSeconds) {
  const payload = Buffer.from(JSON.stringify({ sub: 'ana', exp: expSeconds })).toString('base64url');
  return `h.${payload}.s`;
}

test('guarda y recupera la sesión', () => {
  const store = fakeStore();
  const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  createServerSession({ store, safeStorage: fakeSafeStorage() }).save(token, { username: 'ana', role: 'QA_ANALYST' });
  const loaded = createServerSession({ store, safeStorage: fakeSafeStorage() }).load();
  assert.equal(loaded.token, token);
  assert.equal(loaded.user.username, 'ana');
});

test('el token no queda en claro en el store', () => {
  const store = fakeStore();
  const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  createServerSession({ store, safeStorage: fakeSafeStorage() }).save(token, { username: 'ana' });
  assert.equal(JSON.stringify(store.getSetting('serverSession')).includes(token), false);
});

test('sin sesión devuelve null', () => {
  assert.equal(createServerSession({ store: fakeStore(), safeStorage: fakeSafeStorage() }).load(), null);
});

test('cifrado de otra cuenta de Windows -> load devuelve null, no rompe', () => {
  const store = fakeStore();
  createServerSession({ store, safeStorage: fakeSafeStorage() }).save(jwtWithExp(9999999999), { username: 'ana' });
  const roto = { ...fakeSafeStorage(), decryptString: () => { throw new Error('otra cuenta'); } };
  assert.equal(createServerSession({ store, safeStorage: roto }).load(), null);
});

test('isExpired: futuro es false, pasado es true', () => {
  const s = createServerSession({ store: fakeStore(), safeStorage: fakeSafeStorage() });
  assert.equal(s.isExpired(jwtWithExp(Math.floor(Date.now() / 1000) + 3600)), false);
  assert.equal(s.isExpired(jwtWithExp(Math.floor(Date.now() / 1000) - 10)), true);
});

test('isExpired: un token ilegible es tratado como expirado', () => {
  const s = createServerSession({ store: fakeStore(), safeStorage: fakeSafeStorage() });
  assert.equal(s.isExpired('no-es-jwt'), true);
});

test('clear borra la sesión', () => {
  const store = fakeStore();
  const s = createServerSession({ store, safeStorage: fakeSafeStorage() });
  s.save(jwtWithExp(9999999999), { username: 'ana' });
  s.clear();
  assert.equal(s.load(), null);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/server-session.test.js`
Expected: FAIL — `createServerSession is not a function`.

- [ ] **Step 3: Implementar**

`main/server/session.js`:

```javascript
const { appError } = require('../errors');

const KEY = 'serverSession';

/** Lee el claim `exp` (segundos epoch) del payload de un JWT, sin verificar la firma. */
function readExp(token) {
  try {
    const payload = String(token).split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/**
 * Sesión del backend cifrada con safeStorage (igual que la cuenta de GitHub):
 * el token va cifrado, el usuario en claro (no es secreto y permite pintar la UI
 * sin red). El `exp` se deriva del propio JWT.
 */
function createServerSession({ store, safeStorage }) {
  return {
    save(token, user) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw appError('SECURE_STORAGE_UNAVAILABLE', 'Este equipo no puede guardar la sesión de forma segura.');
      }
      store.setSetting(KEY, {
        token: safeStorage.encryptString(token).toString('base64'),
        user: user || null,
        savedAt: new Date().toISOString(),
      });
    },

    load() {
      const saved = store.getSetting(KEY);
      if (!saved?.token || !safeStorage.isEncryptionAvailable()) return null;
      try {
        const token = safeStorage.decryptString(Buffer.from(saved.token, 'base64'));
        const exp = readExp(token);
        return { token, user: saved.user || null, expiresAt: exp ? exp * 1000 : null };
      } catch {
        return null;
      }
    },

    isExpired(token) {
      const exp = readExp(token);
      if (exp === null) return true;
      return Date.now() >= exp * 1000;
    },

    clear() {
      store.setSetting(KEY, null);
    },
  };
}

module.exports = { createServerSession };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test test/server-session.test.js`
Expected: PASS — 7 casos.

- [ ] **Step 5: Suite completa + inspección working tree (sin commitear)**

Run: `npm test`
Expected: PASS — 197 + 7 = 204.

---

### Task 2: `client.js` — cliente HTTP (TDD)

**Files:**
- Create: `main/server/client.js`
- Test: `test/server-client.test.js`

**Interfaces:**
- Produces: `createServerClient({ baseUrl, fetchImpl = fetch })` → `{ login(username, password), postRun(token, record), syncModules(token, { repoUrl, projectName, modules }) }`.
  - Ninguno lanza por error de red: devuelven `{ ok, status, data?, error?, code? }`.
  - `login` → `{ ok:true, token, user }` o `{ ok:false, error, code }` (`code:'BAD_CREDENTIALS'` en 401).
  - `postRun` → `{ ok:true, created }` (`created:false` en 204) o `{ ok:false, status, error, code }` (`code:'UNAUTHORIZED'` en 401/403).
  - `syncModules` → `{ ok:true }` o `{ ok:false, … }`.

- [ ] **Step 1: Escribir el test que falla**

`test/server-client.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServerClient } = require('../main/server/client');

/** fetch falso: responde según una tabla url->{status, body}. Registra las llamadas. */
function fakeFetch(routes, calls = []) {
  return async (url, opts) => {
    calls.push({ url, opts });
    const r = routes[url];
    if (r === 'NETWORK') throw new Error('ECONNREFUSED');
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    };
  };
}

const BASE = 'http://srv:8080';

test('login OK devuelve token y usuario', async () => {
  const routes = { [`${BASE}/api/auth/login`]: { status: 200, body: { success: true, data: { token: 'tok', username: 'ana', fullName: 'Ana', role: 'QA_ANALYST' } } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).login('ana', 'pw');
  assert.equal(res.ok, true);
  assert.equal(res.token, 'tok');
  assert.equal(res.user.username, 'ana');
});

test('login con credenciales malas -> BAD_CREDENTIALS', async () => {
  const routes = { [`${BASE}/api/auth/login`]: { status: 401, body: { success: false, message: 'Credenciales incorrectas' } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).login('ana', 'mala');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'BAD_CREDENTIALS');
});

test('login sin red no lanza: devuelve ok:false', async () => {
  const routes = { [`${BASE}/api/auth/login`]: 'NETWORK' };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).login('ana', 'pw');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NETWORK');
});

test('postRun 200 -> created true, manda el Bearer', async () => {
  const calls = [];
  const routes = { [`${BASE}/api/runs`]: { status: 200, body: { success: true } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes, calls) }).postRun('tok', { runId: 'run-1' });
  assert.equal(res.ok, true);
  assert.equal(res.created, true);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
});

test('postRun 204 -> ok:true, created false (ya existía)', async () => {
  const routes = { [`${BASE}/api/runs`]: { status: 204 } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).postRun('tok', { runId: 'run-1' });
  assert.equal(res.ok, true);
  assert.equal(res.created, false);
});

test('postRun 401 -> UNAUTHORIZED', async () => {
  const routes = { [`${BASE}/api/runs`]: { status: 401 } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) }).postRun('tok', { runId: 'run-1' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'UNAUTHORIZED');
});

test('syncModules OK', async () => {
  const routes = { [`${BASE}/api/sync/modules`]: { status: 200, body: { success: true } } };
  const res = await createServerClient({ baseUrl: BASE, fetchImpl: fakeFetch(routes) })
    .syncModules('tok', { repoUrl: 'https://git/x.git', projectName: 'ERP', modules: ['a'] });
  assert.equal(res.ok, true);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/server-client.test.js`
Expected: FAIL — `createServerClient is not a function`.

- [ ] **Step 3: Implementar**

`main/server/client.js`:

```javascript
/**
 * Cliente HTTP del backend qa-reports. No lanza por errores de red: devuelve un
 * resultado uniforme para que la cola y el sender decidan reintentar. `fetchImpl`
 * se inyecta en los tests (igual que notify-n8n.js).
 */
function createServerClient({ baseUrl, fetchImpl = fetch }) {
  const url = (path) => `${String(baseUrl).replace(/\/$/, '')}${path}`;

  async function call(path, { method = 'POST', token = null, body = null } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetchImpl(url(path), { method, headers, body: body ? JSON.stringify(body) : undefined });
      let data = null;
      if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
      return { res, data };
    } catch (err) {
      return { networkError: err.message || String(err) };
    }
  }

  return {
    async login(username, password) {
      const { res, data, networkError } = await call('/api/auth/login', { body: { username, password } });
      if (networkError) return { ok: false, code: 'NETWORK', error: networkError };
      if (res.status === 401) return { ok: false, code: 'BAD_CREDENTIALS', error: (data && data.message) || 'Credenciales incorrectas' };
      if (!res.ok || !data?.data?.token) return { ok: false, status: res.status, error: (data && data.message) || 'No se pudo iniciar sesión.' };
      const d = data.data;
      return { ok: true, token: d.token, user: { username: d.username, fullName: d.fullName, role: d.role } };
    },

    async postRun(token, record) {
      const { res, networkError } = await call('/api/runs', { token, body: record });
      if (networkError) return { ok: false, code: 'NETWORK', error: networkError };
      if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, code: 'UNAUTHORIZED', error: 'La sesión no es válida.' };
      if (res.status === 204) return { ok: true, created: false };
      if (res.ok) return { ok: true, created: true };
      return { ok: false, status: res.status, code: 'SERVER', error: `El servidor respondió ${res.status}` };
    },

    async syncModules(token, payload) {
      const { res, networkError } = await call('/api/sync/modules', { token, body: payload });
      if (networkError) return { ok: false, code: 'NETWORK', error: networkError };
      if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, code: 'UNAUTHORIZED' };
      if (res.ok) return { ok: true };
      return { ok: false, status: res.status, code: 'SERVER', error: `El servidor respondió ${res.status}` };
    },
  };
}

module.exports = { createServerClient };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test test/server-client.test.js`
Expected: PASS — 7 casos.

- [ ] **Step 5: Suite + inspección working tree (sin commitear)**

Run: `npm test` → PASS (204 + 7 = 211).

---

### Task 3: `queue.js` — cola durable en disco (TDD)

**Files:**
- Create: `main/server/queue.js`
- Test: `test/server-queue.test.js`

**Interfaces:**
- Produces: `createOutbox({ dir, maxItems = 500 })` → `{ enqueue(record), list(), remove(runId), setDiscarded(runId, value) }`.
  - `enqueue(record)`: escribe `dir/<record.runId>.json`. Si al hacerlo se supera `maxItems`, borra los más antiguos (por `enqueuedAt`) y devuelve cuántos descartó.
  - `list()`: registros ordenados por `enqueuedAt` ascendente (los más viejos primero, para enviarlos en orden), ignorando JSON ilegibles.
  - `remove(runId)`: borra el archivo.
  - `setDiscarded(runId, value)`: si el archivo sigue en la cola, actualiza `record.discardedByQa`; si no, no-op.

- [ ] **Step 1: Escribir el test que falla**

`test/server-queue.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOutbox } = require('../main/server/queue');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-outbox-'));
const rec = (runId, over = {}) => ({ runId, repoUrl: 'https://git/x.git', discardedByQa: false, ...over });

test('enqueue y list hacen ida y vuelta', () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const items = box.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].runId, 'run-1');
});

test('list ordena por enqueuedAt ascendente e ignora JSON roto', () => {
  const dir = tempDir();
  const box = createOutbox({ dir });
  box.enqueue(rec('run-1'));
  box.enqueue(rec('run-2'));
  fs.writeFileSync(path.join(dir, 'roto.json'), '{ no json');
  assert.deepEqual(box.list().map((r) => r.runId), ['run-1', 'run-2']);
});

test('remove borra el ítem', () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  box.remove('run-1');
  assert.equal(box.list().length, 0);
});

test('sobrevive a recrear el store (persistencia en disco)', () => {
  const dir = tempDir();
  createOutbox({ dir }).enqueue(rec('run-1'));
  assert.equal(createOutbox({ dir }).list().length, 1);
});

test('setDiscarded actualiza el ítem encolado', () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1', { discardedByQa: false }));
  box.setDiscarded('run-1', true);
  assert.equal(box.list()[0].discardedByQa, true);
});

test('setDiscarded sobre un ítem ya enviado (ausente) no rompe', () => {
  const box = createOutbox({ dir: tempDir() });
  assert.doesNotThrow(() => box.setDiscarded('run-inexistente', true));
});

test('el tope descarta los más antiguos', () => {
  const box = createOutbox({ dir: tempDir(), maxItems: 2 });
  box.enqueue(rec('run-1'));
  box.enqueue(rec('run-2'));
  const descartados = box.enqueue(rec('run-3'));
  const ids = box.list().map((r) => r.runId);
  assert.equal(ids.length, 2);
  assert.equal(ids.includes('run-1'), false); // el más viejo se fue
  assert.equal(descartados, 1);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/server-queue.test.js`
Expected: FAIL — `createOutbox is not a function`.

- [ ] **Step 3: Implementar**

`main/server/queue.js`:

```javascript
const fs = require('node:fs');
const path = require('node:path');

/**
 * Cola durable de corridas pendientes de enviar al backend: un JSON por corrida
 * bajo `dir/<runId>.json`. Sin dependencias de Electron (testeable con dir temporal).
 * El envío nunca debe perder una corrida por estar el servidor caído; el tope
 * `maxItems` evita que la cola crezca sin límite si lleva mucho tiempo sin drenar.
 */
function createOutbox({ dir, maxItems = 500 }) {
  const file = (runId) => path.join(dir, `${runId}.json`);

  function readAll() {
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => String(a.enqueuedAt).localeCompare(String(b.enqueuedAt)));
  }

  function write(record) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file(record.runId), JSON.stringify(record, null, 2), 'utf8');
  }

  return {
    enqueue(record) {
      write({ ...record, enqueuedAt: record.enqueuedAt || new Date().toISOString() });
      const items = readAll();
      let discarded = 0;
      for (let i = 0; i < items.length - maxItems; i++) {
        fs.rmSync(file(items[i].runId), { force: true });
        discarded++;
      }
      return discarded;
    },
    list() { return readAll(); },
    remove(runId) { fs.rmSync(file(runId), { force: true }); },
    setDiscarded(runId, value) {
      let record;
      try { record = JSON.parse(fs.readFileSync(file(runId), 'utf8')); } catch { return; }
      record.discardedByQa = value;
      write(record);
    },
  };
}

module.exports = { createOutbox };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test test/server-queue.test.js`
Expected: PASS — 7 casos.

- [ ] **Step 5: Suite + inspección working tree (sin commitear)**

Run: `npm test` → PASS (211 + 7 = 218).

---

### Task 4: `sender.js` — worker que drena la cola (TDD)

**Files:**
- Create: `main/server/sender.js`
- Test: `test/server-sender.test.js`

**Interfaces:**
- Consumes: `outbox` (Task 3), un `client` con `postRun(token, record)` (Task 2), un `getToken()` que devuelve el token vigente o `null`.
- Produces: `createSender({ outbox, client, getToken, onChange = () => {} })` → `{ drain(), pending() }`.
  - `drain()`: recorre `outbox.list()`; para cada ítem, si hay token, `client.postRun`; si `ok` (creado o 204) → `outbox.remove`; si `NETWORK`/`SERVER` → se detiene (reintentará luego, sin perder orden); si `UNAUTHORIZED` → se detiene (necesita re-login). Devuelve `{ sent, remaining, stoppedBy }`. Llama `onChange()` si cambió la cuenta de pendientes.
  - `pending()`: `outbox.list().length`.

- [ ] **Step 1: Escribir el test que falla**

`test/server-sender.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOutbox } = require('../main/server/queue');
const { createSender } = require('../main/server/sender');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-sender-'));
const rec = (runId) => ({ runId, repoUrl: 'https://git/x.git' });

function clientThatAlways(result, calls = []) {
  return { postRun: async (token, record) => { calls.push({ token, runId: record.runId }); return result; } };
}

test('drena y borra lo enviado, en orden', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1')); box.enqueue(rec('run-2'));
  const calls = [];
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: true, created: true }, calls), getToken: () => 'tok' });
  const r = await sender.drain();
  assert.equal(r.sent, 2);
  assert.equal(box.list().length, 0);
  assert.deepEqual(calls.map((c) => c.runId), ['run-1', 'run-2']);
});

test('un 204 (ya existía) también saca el ítem de la cola', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: true, created: false }), getToken: () => 'tok' });
  await sender.drain();
  assert.equal(box.list().length, 0);
});

test('sin red se detiene y conserva la cola', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: false, code: 'NETWORK' }), getToken: () => 'tok' });
  const r = await sender.drain();
  assert.equal(r.sent, 0);
  assert.equal(r.stoppedBy, 'NETWORK');
  assert.equal(box.list().length, 1);
});

test('sin token no intenta enviar', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const calls = [];
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: true, created: true }, calls), getToken: () => null });
  const r = await sender.drain();
  assert.equal(calls.length, 0);
  assert.equal(r.stoppedBy, 'NO_TOKEN');
  assert.equal(box.list().length, 1);
});

test('UNAUTHORIZED se detiene sin borrar (hay que re-login)', async () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: false, code: 'UNAUTHORIZED' }), getToken: () => 'tok' });
  const r = await sender.drain();
  assert.equal(r.stoppedBy, 'UNAUTHORIZED');
  assert.equal(box.list().length, 1);
});

test('pending() cuenta lo encolado', () => {
  const box = createOutbox({ dir: tempDir() });
  box.enqueue(rec('run-1'));
  const sender = createSender({ outbox: box, client: clientThatAlways({ ok: true }), getToken: () => 'tok' });
  assert.equal(sender.pending(), 1);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/server-sender.test.js`
Expected: FAIL — `createSender is not a function`.

- [ ] **Step 3: Implementar**

`main/server/sender.js`:

```javascript
/**
 * Drena la cola de corridas hacia el backend. No paraleliza: envía en orden y se
 * detiene ante el primer fallo recuperable (sin red, servidor caído) para
 * reintentar en la próxima pasada sin desordenar ni perder corridas. Un
 * UNAUTHORIZED también detiene: hace falta re-login.
 */
function createSender({ outbox, client, getToken, onChange = () => {} }) {
  let draining = false;

  async function drain() {
    if (draining) return { sent: 0, remaining: outbox.list().length, stoppedBy: 'BUSY' };
    draining = true;
    let sent = 0;
    let stoppedBy = null;
    try {
      for (const record of outbox.list()) {
        const token = getToken();
        if (!token) { stoppedBy = 'NO_TOKEN'; break; }
        const res = await client.postRun(token, record);
        if (res.ok) {
          outbox.remove(record.runId);
          sent++;
        } else if (res.code === 'UNAUTHORIZED') {
          stoppedBy = 'UNAUTHORIZED'; break;
        } else {
          stoppedBy = res.code || 'SERVER'; break;   // NETWORK / SERVER: reintentar luego
        }
      }
    } finally {
      draining = false;
    }
    if (sent > 0) onChange();
    return { sent, remaining: outbox.list().length, stoppedBy };
  }

  return { drain, pending: () => outbox.list().length };
}

module.exports = { createSender };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test test/server-sender.test.js`
Expected: PASS — 6 casos.

- [ ] **Step 5: Suite + inspección working tree (sin commitear)**

Run: `npm test` → PASS (218 + 6 = 224).

---

### Task 5: Wiring en `ipc.js` y `preload.js`

Instancia los módulos, expone login/logout/estado y URL del servidor, encola cada corrida al terminar, sincroniza módulos al leer el árbol y arranca el sender.

**Files:**
- Modify: `main/ipc.js`
- Modify: `preload.js`

**Interfaces:**
- Consumes: `createServerSession` (Task 1), `createServerClient` (Task 2), `createOutbox` (Task 3), `createSender` (Task 4); `store` (config-store), `safeStorage`, `getWindow` (ya en `registerIpc`).
- Produces (IPC): `auth:login`, `auth:logout`, `auth:status`, `config:getServerUrl`, `config:setServerUrl`; evento `server:pending` hacia el renderer; wrappers en preload.

> `ipc.js` no tiene suite unitaria (la lógica vive en los módulos ya probados en Tasks 1-4). Se verifica con `node --check` y `npm test` en verde.

- [ ] **Step 1: Requerir e instanciar los módulos**

En `main/ipc.js`, junto a los demás `require` de la cabecera (después de la línea `const { createRecordingsUploader } = require('./recordings/upload');`):

```javascript
const { createServerSession } = require('./server/session');
const { createServerClient } = require('./server/client');
const { createOutbox } = require('./server/queue');
const { createSender } = require('./server/sender');
```

Dentro de `registerIpc`, después de instanciar `uploader` (la línea `const uploader = createRecordingsUploader({...});`):

```javascript
  const DEFAULT_SERVER_URL = 'http://localhost:8080';
  const serverSession = createServerSession({ store, safeStorage });
  const serverUrl = () => store.getSetting('serverUrl') || DEFAULT_SERVER_URL;
  // Cliente fresco por uso: así un cambio de URL en Configuración se toma sin reiniciar.
  const newServerClient = () => createServerClient({ baseUrl: serverUrl() });
  const outbox = createOutbox({ dir: path.join(userData, 'outbox') });
  const serverSender = createSender({
    outbox,
    client: { postRun: (token, record) => newServerClient().postRun(token, record) },
    getToken: () => {
      const s = serverSession.load();
      return s && !serverSession.isExpired(s.token) ? s.token : null;
    },
    onChange: () => getWindow()?.webContents.send('server:pending', outbox.list().length),
  });
  // Intento inicial de drenado al arrancar (por si quedaron corridas de una sesión previa).
  serverSender.drain();
```

- [ ] **Step 2: Handlers de auth y URL del servidor**

En `main/ipc.js`, en la sección de la cuenta de GitHub o junto a ella, añadir:

```javascript
  ipcMain.handle('auth:login', async (_event, username, password) => {
    const res = await newServerClient().login(username, password);
    if (!res.ok) return { ok: false, error: res.error, code: res.code };
    serverSession.save(res.token, res.user);
    serverSender.drain();   // por si había corridas encoladas esperando sesión
    return { ok: true, user: res.user };
  });

  ipcMain.handle('auth:logout', () => { serverSession.clear(); return { ok: true }; });

  ipcMain.handle('auth:status', () => {
    const s = serverSession.load();
    if (!s) return { authenticated: false };
    return { authenticated: !serverSession.isExpired(s.token), user: s.user, pending: outbox.list().length };
  });

  ipcMain.handle('config:getServerUrl', () => serverUrl());
  ipcMain.handle('config:setServerUrl', (_event, url) => {
    store.setSetting('serverUrl', String(url || '').trim() || null);
    return { ok: true, serverUrl: serverUrl() };
  });
```

- [ ] **Step 3: Encolar cada corrida al terminar**

En el handler `run:start`, dentro del bloque `try`, **después** de construir `lastRun` (justo antes de `return { ...outcome, summary: lastRun.summary, runId };`):

```javascript
      // Telemetría: TODA corrida se encola para el backend (el panel local solo
      // decide lo local). repoUrl es la clave de correlación; discardedByQa se
      // ajusta luego si el QA descarta (ver results:save / results:discard).
      outbox.enqueue({
        runId: lastRun.id,
        repoUrl: project.repoUrl || null,
        projectName: lastRun.projectName,
        profileId: lastRun.profileId,
        profileName: lastRun.profileName,
        startedAt: lastRun.startedAt,
        finishedAt: lastRun.finishedAt,
        mode: lastRun.mode,
        total: lastRun.summary.total,
        passed: lastRun.summary.passed,
        failed: lastRun.summary.failed,
        skipped: lastRun.summary.skipped,
        durationMs: lastRun.durationMs,
        discardedByQa: false,
        tests: lastRun.tests,
      });
      serverSender.drain();
```

- [ ] **Step 4: Marcar descartada y sincronizar módulos**

En el handler `results:save` no hace falta cambiar el flag (guardar local no es descartar). Añadir un handler para cuando el QA **descarta** (el renderer lo llamará desde el panel de decisión):

```javascript
  ipcMain.handle('results:discard', (_event, runId) => {
    outbox.setDiscarded(runId, true);
    serverSender.drain();
    return { ok: true };
  });
```

Y en `tests:getTree`, tras obtener el árbol, sincronizar el catálogo (best-effort, no bloquea):

En el handler `tests:getTree` actual, reemplazar el cuerpo por:

```javascript
  ipcMain.handle('tests:getTree', async (_event, projectId) => {
    try {
      const repoPath = await ensureRepoPath(projectId);
      const tree = await listTests({ repoPath, cliPath: locatePlaywrightCli(repoPath) });
      // Sincroniza los módulos (carpetas) con el backend, sin bloquear ni fallar la UI.
      const project = store.getProject(projectId);
      const s = serverSession.load();
      if (project.repoUrl && s && !serverSession.isExpired(s.token)) {
        const modules = tree.map((suite) => suite.name).filter((n) => n && n !== 'General');
        newServerClient()
          .syncModules(s.token, { repoUrl: project.repoUrl, projectName: project.name || projectId, modules })
          .catch(() => {});
      }
      return tree;
    } catch (err) {
      showError(err);
      return [];
    }
  });
```

- [ ] **Step 5: Exponer en `preload.js`**

En `preload.js`, añadir una sección:

```javascript
  // sesión del backend
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  logout: () => ipcRenderer.invoke('auth:logout'),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  getServerUrl: () => ipcRenderer.invoke('config:getServerUrl'),
  setServerUrl: (url) => ipcRenderer.invoke('config:setServerUrl', url),
  discardResult: (runId) => ipcRenderer.invoke('results:discard', runId),
  onServerPending: (cb) => ipcRenderer.on('server:pending', (_e, n) => cb(n)),
```

- [ ] **Step 6: Verificar**

Run: `node --check main/ipc.js && node --check preload.js && npm test`
Expected: OK en los dos `--check`; PASS 224 (sin tests nuevos; nada roto).

- [ ] **Step 7: Inspección working tree (sin commitear).**

Revisar los diffs de `ipc.js` y `preload.js` con snapshots antes/después.

---

### Task 6: Renderer — login que bloquea y contador de pendientes

**Files:**
- Modify: `renderer/renderer.js`

**Interfaces:**
- Consumes: `api.login/logout/authStatus/onServerPending/discardResult` (Task 5); `state`, `$main`, `$overlay`, `escapeHtml`, `init` (existentes).
- Produces: `renderLogin()`, `state.auth`, `state.serverPending`.

- [ ] **Step 1: Estado de auth**

En `renderer/renderer.js`, en el objeto `state` (junto a las demás claves), añadir:

```javascript
  auth: null,            // { username, fullName, role } o null
  serverPending: 0,      // corridas en cola de envío al backend
```

- [ ] **Step 2: Bloquear el arranque hasta iniciar sesión**

En `init()`, al principio (después de `wireApiEvents();` y antes de `await loadGithubStatus();`), añadir la comprobación de sesión:

```javascript
  const status = await api.authStatus();
  state.auth = status.authenticated ? status.user : null;
  state.serverPending = status.pending || 0;
  api.onServerPending((n) => { state.serverPending = n; renderSidebarStatus(); });
  if (!state.auth) { renderLogin(); return; }
```

- [ ] **Step 3: Pantalla de login**

Añadir `renderLogin()` (por ejemplo antes de `renderEmptyProject`):

```javascript
function renderLogin() {
  $main.innerHTML = `
    <div class="screen" style="display:grid;place-items:center;padding:40px">
      <div style="width:360px;max-width:100%">
        <div class="screen-title" style="text-align:center">Inicia sesión</div>
        <div class="screen-subtitle" style="text-align:center;margin:8px 0 22px">
          Identifícate con tu cuenta de QA para reportar tus corridas.
        </div>
        <input id="login-user" type="text" placeholder="Usuario" autofocus
          style="width:100%;padding:11px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box;margin-bottom:10px">
        <input id="login-pass" type="password" placeholder="Contraseña"
          style="width:100%;padding:11px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
        <div id="login-error" style="display:none;color:#b91c1c;font-size:12px;margin-top:10px"></div>
        <button class="btn btn-primary" id="login-go" style="width:100%;margin-top:16px">Entrar</button>
      </div>
    </div>`;

  const submit = async () => {
    const btn = document.getElementById('login-go');
    const err = document.getElementById('login-error');
    err.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Entrando…';
    const res = await api.login(
      document.getElementById('login-user').value.trim(),
      document.getElementById('login-pass').value,
    );
    if (!res.ok) {
      err.textContent = res.error || 'No se pudo iniciar sesión.';
      err.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Entrar';
      return;
    }
    state.auth = res.user;
    // Re-arranca limpio: evita doble registro de listeners IPC (init/wireApiEvents
    // se ejecutan una sola vez por carga). Al recargar, authStatus ya da autenticado.
    window.location.reload();
  };

  document.getElementById('login-go').onclick = submit;
  document.getElementById('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}
```

- [ ] **Step 4: Descarte que informa al backend**

En el panel de decisión post-corrida (`renderSaveDecision` / donde esté el botón "Descartar"), en el handler de descartar, añadir la llamada antes de navegar:

```javascript
    if (state.currentRunId) api.discardResult(state.currentRunId);
```

(Buscar el `onclick` del botón Descartar en `renderSaveDecision`; añadir esa línea al inicio del handler. Si el id de la corrida se guarda en otra variable de estado, usar esa.)

- [ ] **Step 5: Contador de pendientes en el sidebar**

En `renderSidebarStatus()`, añadir (donde se pinta el estado de la cuenta/sync) un indicador cuando haya pendientes:

```javascript
  // Corridas esperando envío al backend (cola offline).
  if (state.serverPending > 0) {
    // Reutiliza el estilo de estado del sidebar; texto discreto.
    const pend = document.createElement('div');
    pend.className = 'sidebar-hint';
    pend.textContent = `${state.serverPending} corrida(s) por enviar`;
    // Insertar donde encaje con el layout actual del sidebar.
    document.getElementById('sidebar-status')?.appendChild(pend);
  }
```

> Nota: el ancla exacta (`sidebar-status` y la clase `sidebar-hint`) se ajusta al markup real del sidebar en el momento de implementar; si no existe un contenedor, se añade uno mínimo. El objetivo es un texto discreto "N por enviar".

- [ ] **Step 6: Stubs offline**

En `createBrowserStub`, añadir:

```javascript
    async authStatus() { return { authenticated: true, user: { username: 'demo', fullName: 'QA Demo', role: 'QA_ANALYST' }, pending: 0 }; },
    async login() { return { ok: true, user: { username: 'demo', fullName: 'QA Demo', role: 'QA_ANALYST' } }; },
    async logout() { return { ok: true }; },
    async getServerUrl() { return 'http://localhost:8080'; },
    async setServerUrl() { return { ok: true, serverUrl: 'http://localhost:8080' }; },
    async discardResult() { return { ok: true }; },
    onServerPending() {},
```

- [ ] **Step 7: Verificar**

Run: `node --check renderer/renderer.js && npm test`
Expected: OK en `--check`; PASS 224.

- [ ] **Step 8: Smoke manual (requiere display + backend arriba; lo hace el usuario)**

1. `npm start` sin sesión → aparece la pantalla de login y no deja pasar.
2. Login con `admin` / `Admin2026!` (el que siembra el backend) → entra al flujo normal.
3. Correr una prueba → en el backend aparece la corrida (`/api/runs`); el contador de pendientes vuelve a 0.
4. Bajar el backend, correr otra prueba → queda "1 por enviar"; subir el backend → se drena sola.
5. Reiniciar la app → sigue con sesión (no vuelve a pedir login).

- [ ] **Step 9: Inspección working tree (sin commitear).**

Revisar el diff de `renderer.js` con snapshots antes/después.

---

## Self-Review

**Cobertura del spec (mitad cliente):**

- Login contra `qa-reports`, sesión cifrada, offline → Task 1 (`session`) + Task 2 (`client.login`) + Task 5 (`auth:login`) + Task 6 (pantalla).
- Login obligatorio la primera vez, luego offline con sesión guardada → Task 6 (`init` bloquea si `!state.auth`) + Task 1 (`load`/`isExpired`).
- Enviar **todas** las corridas al terminar, sin bloquear al QA → Task 5 (encolar en `run:start`) + Task 3 (cola) + Task 4 (sender en segundo plano).
- Cola durable con reintentos; nunca pierde corridas ni muestra errores de red → Task 3 + Task 4 (se detiene y reintenta; tope de tamaño).
- `discardedByQa` viaja con la decisión local → Task 3 (`setDiscarded`) + Task 5 (`results:discard`) + Task 6 (botón Descartar).
- Correlación por `repoUrl` (no `projectId`) → Task 5 (se toma `project.repoUrl` al encolar).
- Sincronizar módulos al abrir el proyecto → Task 5 (`tests:getTree` llama `syncModules` con las carpetas, excluyendo `General`).
- URL del servidor como ajuste global → Task 5 (`config:get/setServerUrl`, `setSetting('serverUrl')`).
- Idempotencia ante reenvío (app muere tras enviar, antes de borrar) → Task 4 (un 204 también hace `remove`).
- Token expirado sin red → Task 4 (`getToken` devuelve null si expiró → `NO_TOKEN`, no borra la cola; se re-login luego).

**Fuera de alcance (declarado):** la pantalla de Configuración para editar la URL del servidor (solo se implementan los handlers que la leen/escriben); métricas/paneles en el backend (pieza D); el instalador (pieza A).

**Consistencia de tipos/nombres:** `createServerSession` (Task 1) usado en Task 5. `createServerClient.{login,postRun,syncModules}` (Task 2) usados por Task 4 (`postRun`) y Task 5 (`login`, `syncModules`). `createOutbox.{enqueue,list,remove,setDiscarded}` (Task 3) usados por Task 4 (`list`/`remove`) y Task 5 (`enqueue`/`setDiscarded`). `createSender.{drain,pending}` (Task 4) usado en Task 5. El `record` encolado (Task 5) trae exactamente los campos que `POST /api/runs` del backend espera (`runId`, `repoUrl`, `projectName`, tiempos, `mode`, totales, `durationMs`, `discardedByQa`, `tests[]` con `{id,name,status,durationMs,error,retry}`) — los `tests` salen tal cual de `outcome.tests`. IPC `auth:login/logout/status`, `config:get/setServerUrl`, `results:discard` (los wrappers de preload en Task 5) los consume el renderer en Task 6.

**Riesgo señalado:** el envío de `syncModules` toma el nombre de módulo de `suite.name`, que hoy es el nombre de la carpeta (`build-tree.js`); si un repo no organiza por carpetas, todas las pruebas caen en `General` y se excluyen del sync (correcto: son "sin refinar"). El ancla del contador de pendientes en el sidebar (Task 6 Step 5) es la única pieza que depende del markup actual y se ajusta al implementar.
