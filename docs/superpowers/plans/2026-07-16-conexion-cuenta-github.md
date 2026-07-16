# Conexión de la cuenta de GitHub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el QA conecte su cuenta de GitHub desde la app, vea su estado en el perfil del sidebar, pueda desconectarla, y que `git` use esa cuenta al traer y actualizar repositorios privados.

**Architecture:** Cuatro módulos nuevos bajo `main/github/`, cada uno con una sola responsabilidad y con dependencias inyectadas (`fetch`, `sleep`, `safeStorage`, `store`), igual que `main/projects.js` inyecta hoy `run`. El token se consigue por device flow, se guarda cifrado con `safeStorage` y se le pasa a `git` por variable de entorno con un ayudante de credenciales acotado a `github.com`. `main/projects.js` sólo cambia en su función `git()` interna.

**Tech Stack:** Electron 30 (`safeStorage`, `shell.openExternal`, `ipcMain`), Node 20 (`fetch` global), `node:test` + `node:assert/strict` para las pruebas.

**Spec:** `docs/superpowers/specs/2026-07-16-conexion-cuenta-github-design.md`

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `main/github/config.js` (crear) | `CLIENT_ID` y `SCOPE`. Único sitio con la configuración de la OAuth App. |
| `main/github/device-flow.js` (crear) | Conseguir el token de GitHub. No sabe guardar ni pintar. |
| `main/github/identity.js` (crear) | Con un token, saber quién es. |
| `main/github/account.js` (crear) | Guardar/leer/borrar el token cifrado. No sabe de red. |
| `main/github/git-auth.js` (crear) | Traducir un token a argumentos y entorno de `git`. |
| `main/config-store.js` (modificar) | Gana `getSetting`/`setSetting` para claves globales. |
| `main/projects.js` (modificar) | `git()` autenticado + traducir "sin acceso". |
| `main/ipc.js` (modificar) | Handlers `github:*` y cableado. |
| `preload.js` (modificar) | Exponer los handlers en `window.qa`. |
| `renderer/renderer.js` (modificar) | Estado en el perfil, menú, modal, bloqueo. |
| `renderer/index.html` (modificar) | Punto en el avatar y franja de aviso. |
| `renderer/styles.css` (modificar) | Estilos de esos dos elementos. |

**Nota sobre el `client_id`:** no lo tenemos todavía (ver *Prerequisito bloqueante* del spec). El plan no lo inventa: `config.js` lo lee de `QA_GITHUB_CLIENT_ID` y, si falta, `github:connect` devuelve un error claro (Task 9). Todo lo demás se prueba con dobles. La verificación manual end-to-end queda pendiente de ese dato.

---

### Task 1: `config-store` guarda claves globales

**Files:**
- Modify: `electron-app/main/config-store.js`
- Test: `electron-app/test/config-store.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Añade al final de `test/config-store.test.js`:

```js
test('getSetting devuelve undefined cuando la clave no existe', () => {
  assert.equal(createConfigStore(tempDir()).getSetting('github'), undefined);
});

test('setSetting persiste una clave global sin pisar los proyectos', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setProject('erp', { profile: 'demo' });
  store.setSetting('github', { token: 'xyz' });
  assert.deepEqual(createConfigStore(dir).getSetting('github'), { token: 'xyz' });
  assert.deepEqual(createConfigStore(dir).getProject('erp'), { profile: 'demo' });
});

test('setProject no borra las claves globales', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setSetting('github', { token: 'xyz' });
  store.setProject('erp', { profile: 'demo' });
  assert.deepEqual(createConfigStore(dir).getSetting('github'), { token: 'xyz' });
});

test('setSetting con null borra la clave', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setSetting('github', { token: 'xyz' });
  store.setSetting('github', null);
  assert.equal(createConfigStore(dir).getSetting('github'), undefined);
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/config-store.test.js`
Expected: FAIL — `store.getSetting is not a function`

- [ ] **Step 3: Implementa**

En `main/config-store.js`, extrae el escritor y añade los dos métodos. Reemplaza desde `return {` hasta el cierre:

```js
  function writeAll(data) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    listProjects() {
      const data = readAll();
      return Object.entries(data.projects || {}).map(([id, project]) => ({ id, ...project }));
    },

    getProject(projectId) {
      const data = readAll();
      return (data.projects && data.projects[projectId]) || {};
    },

    setProject(projectId, patch) {
      const data = readAll();
      if (!data.projects) data.projects = {};
      data.projects[projectId] = { ...data.projects[projectId], ...patch };
      writeAll(data);
      return data.projects[projectId];
    },

    /** Claves de alcance global (no ligadas a un proyecto), en la raíz del JSON. */
    getSetting(key) {
      return readAll()[key];
    },

    setSetting(key, value) {
      const data = readAll();
      if (value === null || value === undefined) delete data[key];
      else data[key] = value;
      writeAll(data);
      return data[key];
    },
  };
```

- [ ] **Step 4: Corre los tests**

Run: `cd electron-app && node --test test/config-store.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/config-store.js electron-app/test/config-store.test.js
git commit -m "feat(config-store): claves de alcance global con getSetting/setSetting"
```

---

### Task 2: `git-auth` traduce el token a argumentos y entorno

**Files:**
- Create: `electron-app/main/github/git-auth.js`
- Test: `electron-app/test/git-auth.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Crea `test/git-auth.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGitAuth } = require('../main/github/git-auth');

test('el token viaja en el entorno y nunca en los argumentos', () => {
  const auth = createGitAuth(() => 'gho_secreto123');
  assert.equal(auth.args().join(' ').includes('gho_secreto123'), false);
  assert.equal(auth.env().QA_GH_TOKEN, 'gho_secreto123');
});

test('el ayudante sólo se ofrece a github.com', () => {
  const auth = createGitAuth(() => 'x');
  assert.ok(auth.args().some((arg) => arg.startsWith('credential.https://github.com.helper=')));
  assert.ok(auth.args().every((arg) => !arg.startsWith('credential.helper=')));
});

test('limpia los ayudantes heredados antes de poner el suyo', () => {
  const args = createGitAuth(() => 'x').args();
  assert.equal(args[1], 'credential.https://github.com.helper=');
  assert.ok(args[3].startsWith('credential.https://github.com.helper=!f()'));
});

test('git nunca pregunta por teclado, haya cuenta o no', () => {
  assert.equal(createGitAuth(() => 'x').env().GIT_TERMINAL_PROMPT, '0');
  assert.equal(createGitAuth(() => null).env().GIT_TERMINAL_PROMPT, '0');
});

test('sin cuenta conectada no inyecta argumentos ni token', () => {
  const auth = createGitAuth(() => null);
  assert.deepEqual(auth.args(), []);
  assert.equal(auth.env().QA_GH_TOKEN, undefined);
});

test('lee el token en cada llamada, no al construirse', () => {
  let token = null;
  const auth = createGitAuth(() => token);
  assert.deepEqual(auth.args(), []);
  token = 'llegó-después';
  assert.equal(auth.env().QA_GH_TOKEN, 'llegó-después');
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/git-auth.test.js`
Expected: FAIL — `Cannot find module '../main/github/git-auth'`

- [ ] **Step 3: Implementa**

Crea `main/github/git-auth.js`:

```js
/**
 * Traduce el token de la cuenta en la forma de invocar `git` autenticado.
 *
 * El token va SIEMPRE en el entorno y NUNCA en los argumentos: la línea de
 * comandos de un proceso es visible desde el administrador de tareas y desde
 * `ps`; el entorno no lo es para otros usuarios.
 */
const CREDENTIAL_KEY = 'credential.https://github.com.helper';
const HELPER = `!f() { test "$1" = get && printf 'username=x-access-token\\npassword=%s\\n' "$QA_GH_TOKEN"; }; f`;

/** @param getToken función (no el token) para que una desconexión se note en la siguiente invocación. */
function createGitAuth(getToken) {
  return {
    args() {
      if (!getToken()) return [];
      // La clave vacía limpia los ayudantes heredados (p. ej. Git Credential
      // Manager), que si no abrirían su propia ventana.
      return ['-c', `${CREDENTIAL_KEY}=`, '-c', `${CREDENTIAL_KEY}=${HELPER}`];
    },
    env() {
      const token = getToken();
      // Sin GIT_TERMINAL_PROMPT=0, un fallo de credencial deja a git esperando
      // una respuesta por teclado que nunca llega: execFile no le da terminal.
      const base = { GIT_TERMINAL_PROMPT: '0' };
      return token ? { ...base, QA_GH_TOKEN: token } : base;
    },
  };
}

module.exports = { createGitAuth };
```

- [ ] **Step 4: Corre los tests**

Run: `cd electron-app && node --test test/git-auth.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/github/git-auth.js electron-app/test/git-auth.test.js
git commit -m "feat(github): git-auth inyecta el token por entorno, nunca por argumentos"
```

---

### Task 3: `device-flow` pide el código

**Files:**
- Create: `electron-app/main/github/device-flow.js`
- Test: `electron-app/test/device-flow.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Crea `test/device-flow.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { requestDeviceCode } = require('../main/github/device-flow');

const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('pide el código y traduce la respuesta de GitHub', async () => {
  const device = await requestDeviceCode({
    clientId: 'cli123',
    fetch: okJson({
      device_code: 'dev-abc',
      user_code: 'WDJB-MJHT',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900,
    }),
  });
  assert.deepEqual(device, {
    deviceCode: 'dev-abc',
    userCode: 'WDJB-MJHT',
    verificationUri: 'https://github.com/login/device',
    interval: 5,
    expiresIn: 900,
  });
});

test('manda el client_id y el scope pedido', async () => {
  let sent;
  await requestDeviceCode({
    clientId: 'cli123',
    scope: 'repo',
    fetch: async (_url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ device_code: 'd', user_code: 'u', verification_uri: 'v' }) }; },
  });
  assert.deepEqual(sent, { client_id: 'cli123', scope: 'repo' });
});

test('un fallo de red se traduce a GITHUB_UNREACHABLE', async () => {
  await assert.rejects(
    requestDeviceCode({ clientId: 'c', fetch: async () => { throw new Error('ECONNREFUSED'); } }),
    (err) => err.code === 'GITHUB_UNREACHABLE',
  );
});

test('una respuesta HTTP con error se traduce a GITHUB_UNREACHABLE', async () => {
  await assert.rejects(
    requestDeviceCode({ clientId: 'c', fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }),
    (err) => err.code === 'GITHUB_UNREACHABLE',
  );
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/device-flow.test.js`
Expected: FAIL — `Cannot find module '../main/github/device-flow'`

- [ ] **Step 3: Implementa**

Crea `main/github/device-flow.js`:

```js
const { appError } = require('../errors');

const DEVICE_CODE_URL = 'https://github.com/login/device/code';

function unreachable() {
  return appError('GITHUB_UNREACHABLE', 'No se pudo contactar con GitHub. Revisa tu conexión.');
}

async function postJson(fetchFn, url, body) {
  let response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw unreachable();
  }
  if (!response.ok) throw unreachable();
  return response.json();
}

async function requestDeviceCode({ clientId, scope = 'repo', fetch: fetchFn = fetch }) {
  const data = await postJson(fetchFn, DEVICE_CODE_URL, { client_id: clientId, scope });
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval ?? 5,
    expiresIn: data.expires_in ?? 900,
  };
}

module.exports = { requestDeviceCode, postJson, unreachable };
```

- [ ] **Step 4: Corre los tests**

Run: `cd electron-app && node --test test/device-flow.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/github/device-flow.js electron-app/test/device-flow.test.js
git commit -m "feat(github): pedir el código del device flow"
```

---

### Task 4: `device-flow` espera la aprobación

**Files:**
- Modify: `electron-app/main/github/device-flow.js`
- Test: `electron-app/test/device-flow.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Añade a `test/device-flow.test.js` (y añade `pollForToken` al `require` de arriba, que pasa a ser `const { requestDeviceCode, pollForToken } = require('../main/github/device-flow');`):

```js
const replies = (list) => async () => ({ ok: true, status: 200, json: async () => list.shift() });
const base = { clientId: 'c', deviceCode: 'd', interval: 1, expiresIn: 900, sleep: async () => {} };

test('espera mientras está pendiente y devuelve el token al aprobar', async () => {
  const token = await pollForToken({
    ...base,
    fetch: replies([{ error: 'authorization_pending' }, { access_token: 'gho_secreto' }]),
  });
  assert.equal(token, 'gho_secreto');
});

test('slow_down adopta el intervalo nuevo que manda GitHub', async () => {
  const waits = [];
  await pollForToken({
    ...base,
    sleep: async (ms) => { waits.push(ms); },
    fetch: replies([{ error: 'slow_down', interval: 10 }, { access_token: 't' }]),
  });
  assert.deepEqual(waits, [1000, 10000]);
});

test('un código caducado se traduce a GITHUB_CODE_EXPIRED', async () => {
  await assert.rejects(
    pollForToken({ ...base, fetch: replies([{ error: 'expired_token' }]) }),
    (err) => err.code === 'GITHUB_CODE_EXPIRED',
  );
});

test('el rechazo del usuario se traduce a GITHUB_ACCESS_DENIED', async () => {
  await assert.rejects(
    pollForToken({ ...base, fetch: replies([{ error: 'access_denied' }]) }),
    (err) => err.code === 'GITHUB_ACCESS_DENIED',
  );
});

test('agotar el plazo sin aprobación caduca el código', async () => {
  await assert.rejects(
    pollForToken({ ...base, expiresIn: 0, fetch: replies([{ access_token: 'no-debería-pedirse' }]) }),
    (err) => err.code === 'GITHUB_CODE_EXPIRED',
  );
});

test('cancelar aborta la espera', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    pollForToken({ ...base, signal: controller.signal, fetch: replies([{ access_token: 't' }]) }),
    (err) => err.code === 'GITHUB_CONNECT_CANCELLED',
  );
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/device-flow.test.js`
Expected: FAIL — `pollForToken is not a function`

- [ ] **Step 3: Implementa**

En `main/github/device-flow.js`, añade la constante junto a `DEVICE_CODE_URL`:

```js
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
```

Y la función antes del `module.exports`:

```js
function cancelled() {
  return appError('GITHUB_CONNECT_CANCELLED', 'Se canceló la conexión.');
}

async function pollForToken({ clientId, deviceCode, interval = 5, expiresIn = 900, fetch: fetchFn = fetch, sleep, signal }) {
  const deadline = Date.now() + expiresIn * 1000;
  let waitMs = interval * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw cancelled();
    await sleep(waitMs);
    if (signal?.aborted) throw cancelled();

    const data = await postJson(fetchFn, TOKEN_URL, {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    // Ignorar slow_down hace que GitHub corte el flujo entero.
    if (data.error === 'slow_down') { waitMs = (data.interval ?? interval + 5) * 1000; continue; }
    if (data.error === 'expired_token') break;
    if (data.error === 'access_denied') {
      throw appError('GITHUB_ACCESS_DENIED', 'No se autorizó el acceso. Puedes intentarlo otra vez.');
    }
    throw appError('GITHUB_CONNECT_FAILED', 'No fue posible conectar la cuenta.');
  }

  throw appError('GITHUB_CODE_EXPIRED', 'El código caducó. Vuelve a intentarlo.');
}
```

Y cambia el export a:

```js
module.exports = { requestDeviceCode, pollForToken, postJson, unreachable };
```

- [ ] **Step 4: Corre los tests**

Run: `cd electron-app && node --test test/device-flow.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/github/device-flow.js electron-app/test/device-flow.test.js
git commit -m "feat(github): esperar la aprobación del device flow"
```

---

### Task 5: `identity` distingue token muerto de red caída

**Files:**
- Create: `electron-app/main/github/identity.js`
- Test: `electron-app/test/identity.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Crea `test/identity.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchIdentity } = require('../main/github/identity');

test('devuelve la identidad de la cuenta', async () => {
  const identity = await fetchIdentity({
    token: 't',
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ login: 'maria-gomez', name: 'María Gómez', avatar_url: 'https://x/a.png' }) }),
  });
  assert.deepEqual(identity, { login: 'maria-gomez', name: 'María Gómez', avatarUrl: 'https://x/a.png' });
});

test('sin nombre público cae al login', async () => {
  const identity = await fetchIdentity({
    token: 't',
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ login: 'maria-gomez', name: null, avatar_url: 'https://x/a.png' }) }),
  });
  assert.equal(identity.name, 'maria-gomez');
});

test('manda el token en la cabecera', async () => {
  let headers;
  await fetchIdentity({
    token: 'gho_abc',
    fetch: async (_url, options) => { headers = options.headers; return { ok: true, status: 200, json: async () => ({ login: 'x' }) }; },
  });
  assert.equal(headers.Authorization, 'Bearer gho_abc');
});

test('un 401 se traduce a GITHUB_TOKEN_INVALID', async () => {
  await assert.rejects(
    fetchIdentity({ token: 't', fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) }),
    (err) => err.code === 'GITHUB_TOKEN_INVALID',
  );
});

test('un fallo de red se traduce a GITHUB_UNREACHABLE, no a token inválido', async () => {
  await assert.rejects(
    fetchIdentity({ token: 't', fetch: async () => { throw new Error('ENOTFOUND'); } }),
    (err) => err.code === 'GITHUB_UNREACHABLE',
  );
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/identity.test.js`
Expected: FAIL — `Cannot find module '../main/github/identity'`

- [ ] **Step 3: Implementa**

Crea `main/github/identity.js`:

```js
const { appError } = require('../errors');

const USER_URL = 'https://api.github.com/user';

/**
 * Distinguir "el token ya no vale" (401) de "no hay red" es lo que sostiene el
 * modelo de estado: el primero desconecta la cuenta, el segundo la deja
 * conectada con la identidad cacheada. Colapsarlos rompe el caso sin internet.
 */
async function fetchIdentity({ token, fetch: fetchFn = fetch }) {
  let response;
  try {
    response = await fetchFn(USER_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
  } catch {
    throw appError('GITHUB_UNREACHABLE', 'No se pudo contactar con GitHub. Revisa tu conexión.');
  }
  if (response.status === 401) {
    throw appError('GITHUB_TOKEN_INVALID', 'Tu cuenta dejó de estar conectada. Conéctala de nuevo.');
  }
  if (!response.ok) {
    throw appError('GITHUB_UNREACHABLE', 'No se pudo contactar con GitHub. Revisa tu conexión.');
  }
  const data = await response.json();
  return { login: data.login, name: data.name || data.login, avatarUrl: data.avatar_url };
}

module.exports = { fetchIdentity };
```

- [ ] **Step 4: Corre los tests**

Run: `cd electron-app && node --test test/identity.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/github/identity.js electron-app/test/identity.test.js
git commit -m "feat(github): identidad de la cuenta, con 401 y red caída separados"
```

---

### Task 6: `account` guarda el token cifrado

**Files:**
- Create: `electron-app/main/github/account.js`
- Test: `electron-app/test/account.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Crea `test/account.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore } = require('../main/config-store');
const { createAccountStore } = require('../main/github/account');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-account-'));

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (value) => Buffer.from(`cifrado:${value}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^cifrado:/, ''),
});

const identity = { login: 'maria-gomez', name: 'María Gómez', avatarUrl: 'https://x/a.png' };

test('guarda y recupera la cuenta', () => {
  const dir = tempDir();
  createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() }).save('gho_secreto', identity);
  const loaded = createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() }).load();
  assert.equal(loaded.token, 'gho_secreto');
  assert.deepEqual(loaded.identity, identity);
});

test('el token no queda en claro en el config', () => {
  const dir = tempDir();
  createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() }).save('gho_secreto', identity);
  const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  assert.equal(raw.includes('gho_secreto'), false);
});

test('sin cuenta guardada devuelve null', () => {
  assert.equal(createAccountStore({ store: createConfigStore(tempDir()), safeStorage: fakeSafeStorage() }).load(), null);
});

test('sin cifrado disponible lanza y no escribe nada', () => {
  const dir = tempDir();
  const account = createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage(false) });
  assert.throws(() => account.save('gho_secreto', identity), (err) => err.code === 'SECURE_STORAGE_UNAVAILABLE');
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), false);
});

test('un token ilegible se trata como si no hubiera cuenta', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setSetting('github', { token: 'no-es-base64-válido-cifrado', identity });
  const safeStorage = { ...fakeSafeStorage(), decryptString: () => { throw new Error('DPAPI: otro usuario'); } };
  assert.equal(createAccountStore({ store, safeStorage }).load(), null);
});

test('clear borra la cuenta', () => {
  const dir = tempDir();
  const account = createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() });
  account.save('gho_secreto', identity);
  account.clear();
  assert.equal(account.load(), null);
});

test('saveIdentity refresca la caché sin tocar el token', () => {
  const dir = tempDir();
  const account = createAccountStore({ store: createConfigStore(dir), safeStorage: fakeSafeStorage() });
  account.save('gho_secreto', identity);
  account.saveIdentity({ ...identity, name: 'María G. Rojas' });
  const loaded = account.load();
  assert.equal(loaded.token, 'gho_secreto');
  assert.equal(loaded.identity.name, 'María G. Rojas');
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/account.test.js`
Expected: FAIL — `Cannot find module '../main/github/account'`

- [ ] **Step 3: Implementa**

Crea `main/github/account.js`:

```js
const { appError } = require('../errors');

const KEY = 'github';

/**
 * Guarda el token cifrado con safeStorage (DPAPI en Windows, atado a la cuenta
 * de Windows del QA). La identidad se guarda en claro: no es secreta y permite
 * pintar el perfil sin red.
 */
function createAccountStore({ store, safeStorage }) {
  function requireEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw appError('SECURE_STORAGE_UNAVAILABLE', 'Este equipo no puede guardar la cuenta de forma segura.');
    }
  }

  return {
    save(token, identity) {
      // Si no hay cifrado, no se guarda en claro como alternativa: se falla.
      requireEncryption();
      store.setSetting(KEY, {
        token: safeStorage.encryptString(token).toString('base64'),
        identity,
        verifiedAt: new Date().toISOString(),
      });
    },

    load() {
      const saved = store.getSetting(KEY);
      if (!saved?.token) return null;
      if (!safeStorage.isEncryptionAvailable()) return null;
      try {
        return {
          token: safeStorage.decryptString(Buffer.from(saved.token, 'base64')),
          identity: saved.identity || null,
          verifiedAt: saved.verifiedAt || null,
        };
      } catch {
        // Cifrado con otra cuenta de Windows, o config manipulado.
        return null;
      }
    },

    saveIdentity(identity) {
      const saved = store.getSetting(KEY);
      if (!saved?.token) return;
      store.setSetting(KEY, { ...saved, identity, verifiedAt: new Date().toISOString() });
    },

    clear() {
      store.setSetting(KEY, null);
    },
  };
}

module.exports = { createAccountStore };
```

- [ ] **Step 4: Corre los tests**

Run: `cd electron-app && node --test test/account.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/github/account.js electron-app/test/account.test.js
git commit -m "feat(github): guardar el token cifrado con safeStorage"
```

---

### Task 7: `projects.js` invoca `git` autenticado

**Files:**
- Modify: `electron-app/main/projects.js:52-53`
- Test: `electron-app/test/projects.test.js`

- [ ] **Step 1: Escribe el test que falla**

Añade al final de `test/projects.test.js`:

```js
test('git se invoca con la credencial de la cuenta conectada', async () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'node_modules', 'playwright'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'node_modules', 'playwright', 'cli.js'), '');
  fs.writeFileSync(path.join(repoPath, 'package-lock.json'), '{"lockfileVersion":3}');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoPath, 'package-lock.json'))).digest('hex');
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, env: options.env });
    if (args.includes('ls-remote')) return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args.includes('remote')) return { stdout: 'https://example.test/qa.git\n', stderr: '' };
    if (args.includes('rev-parse')) return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const auth = { args: () => ['-c', 'credential.x=y'], env: () => ({ QA_GH_TOKEN: 'tok' }) };
  const manager = createProjectManager({ projectsDir, run, auth });
  await manager.prepare({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main', dependencyLockHash: hash });
  assert.deepEqual(calls[0].args.slice(0, 2), ['-c', 'credential.x=y']);
  assert.equal(calls[0].env.QA_GH_TOKEN, 'tok');
});

test('sin cuenta conectada, git se invoca igual que siempre', async () => {
  const projectsDir = temp();
  const calls = [];
  const run = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  await createProjectManager({ projectsDir, run })
    .initialize({ id: 'x', name: 'X', repoUrl: 'https://example.test/qa.git' })
    .catch(() => {});
  assert.deepEqual(calls[0], ['ls-remote', '--symref', 'https://example.test/qa.git', 'HEAD']);
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/projects.test.js`
Expected: FAIL — el primer test falla porque `calls[0].args.slice(0, 2)` es `['ls-remote', '--symref']`, no `['-c', 'credential.x=y']`

- [ ] **Step 3: Implementa**

En `main/projects.js`, reemplaza las líneas 52-53:

```js
/** Por defecto no inyecta nada: sin cuenta conectada, git se invoca como siempre. */
const NO_AUTH = { args: () => [], env: () => ({}) };

function createProjectManager({ projectsDir, gitPath = 'git', npmPath = process.platform === 'win32' ? 'npm.cmd' : 'npm', run = runFile, auth = NO_AUTH }) {
  const git = (args, cwd) => run(gitPath, [...auth.args(), ...args], {
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, ...auth.env() },
  });
```

- [ ] **Step 4: Corre toda la suite**

Run: `cd electron-app && npm test`
Expected: PASS — incluidos los tests viejos de `projects.test.js`, que siguen comparando `args` sin prefijo porque el `auth` por defecto no inyecta nada.

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/projects.js electron-app/test/projects.test.js
git commit -m "feat(projects): invocar git con la credencial de la cuenta"
```

---

### Task 8: "sin acceso al repositorio" deja de ser un error críptico

**Files:**
- Modify: `electron-app/main/projects.js:47-50`
- Test: `electron-app/test/projects.test.js`

- [ ] **Step 1: Escribe los tests que fallan**

Añade al final de `test/projects.test.js`:

```js
test('un repositorio privado sin acceso se traduce a REPOSITORY_ACCESS_DENIED', async () => {
  const run = async () => {
    throw Object.assign(new Error('Command failed'), {
      stderr: "remote: Repository not found.\nfatal: repository 'https://github.com/equipo/pruebas.git/' not found",
    });
  };
  await assert.rejects(
    createProjectManager({ projectsDir: temp(), run })
      .initialize({ id: 'x', name: 'X', repoUrl: 'https://github.com/equipo/pruebas.git' }),
    (err) => err.code === 'REPOSITORY_ACCESS_DENIED',
  );
});

test('una credencial rechazada también se traduce a REPOSITORY_ACCESS_DENIED', async () => {
  const run = async () => {
    throw Object.assign(new Error('Command failed'), {
      stderr: 'fatal: Authentication failed for https://github.com/equipo/pruebas.git/',
    });
  };
  await assert.rejects(
    createProjectManager({ projectsDir: temp(), run })
      .initialize({ id: 'x', name: 'X', repoUrl: 'https://github.com/equipo/pruebas.git' }),
    (err) => err.code === 'REPOSITORY_ACCESS_DENIED',
  );
});

test('otros fallos de git conservan su mensaje de siempre', async () => {
  const run = async () => {
    throw Object.assign(new Error('Command failed'), { stderr: 'fatal: unable to access: SSL certificate problem' });
  };
  await assert.rejects(
    createProjectManager({ projectsDir: temp(), run })
      .initialize({ id: 'x', name: 'X', repoUrl: 'https://github.com/equipo/pruebas.git' }),
    (err) => err.code === 'REPOSITORY_UNAVAILABLE',
  );
});
```

- [ ] **Step 2: Corre los tests para verificar que fallan**

Run: `cd electron-app && node --test test/projects.test.js`
Expected: FAIL — los dos primeros dan `REPOSITORY_UNAVAILABLE` en vez de `REPOSITORY_ACCESS_DENIED`

- [ ] **Step 3: Implementa**

En `main/projects.js`, reemplaza `friendlyCommandError` (líneas 47-50):

```js
/**
 * GitHub responde 404 —no 403— ante un repositorio privado sin acceso, para no
 * filtrar su existencia. Desde fuera es imposible distinguir "no existe" de "no
 * tienes permiso", así que el mensaje cubre los dos casos sin fingir que sí.
 */
const ACCESS_DENIED = /(repository not found|authentication failed|could not read username|403 forbidden|terminal prompts disabled)/i;

function friendlyCommandError(code, message, err) {
  const stderr = String(err?.stderr || err?.message || '');
  if (ACCESS_DENIED.test(stderr)) {
    return appError('REPOSITORY_ACCESS_DENIED', 'Este proyecto no existe o tu cuenta no tiene acceso. Pídeselo al responsable.');
  }
  const detail = stderr.trim().split(/\r?\n/).slice(-2).join(' ');
  return appError(code, detail ? `${message} ${detail}` : message);
}
```

- [ ] **Step 4: Corre toda la suite**

Run: `cd electron-app && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/projects.js electron-app/test/projects.test.js
git commit -m "feat(projects): mensaje claro cuando la cuenta no tiene acceso al repo"
```

---

### Task 9: configuración de la OAuth App

**Files:**
- Create: `electron-app/main/github/config.js`
- Test: `electron-app/test/github-config.test.js`

- [ ] **Step 1: Escribe el test que falla**

Crea `test/github-config.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { readGithubConfig } = require('../main/github/config');

test('lee el client_id del entorno', () => {
  assert.deepEqual(readGithubConfig({ QA_GITHUB_CLIENT_ID: 'Iv1.abc123' }), { clientId: 'Iv1.abc123', scope: 'repo' });
});

test('sin client_id configurado devuelve cadena vacía, no un valor inventado', () => {
  assert.equal(readGithubConfig({}).clientId, '');
});
```

- [ ] **Step 2: Corre el test para verificar que falla**

Run: `cd electron-app && node --test test/github-config.test.js`
Expected: FAIL — `Cannot find module '../main/github/config'`

- [ ] **Step 3: Implementa**

Crea `main/github/config.js`:

```js
/**
 * Configuración de la OAuth App de GitHub. El client_id del device flow es
 * público (no hay secreto de cliente), así que puede compilarse y distribuirse.
 *
 * Mientras la organización no registre la app, queda vacío y `github:connect`
 * lo dice con un mensaje claro en vez de fallar de forma rara.
 */
const CLIENT_ID_FALLBACK = '';
const SCOPE = 'repo';

function readGithubConfig(env = process.env) {
  return { clientId: env.QA_GITHUB_CLIENT_ID || CLIENT_ID_FALLBACK, scope: SCOPE };
}

module.exports = { readGithubConfig };
```

- [ ] **Step 4: Corre el test**

Run: `cd electron-app && node --test test/github-config.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/github/config.js electron-app/test/github-config.test.js
git commit -m "feat(github): configuración de la OAuth App con override por entorno"
```

---

### Task 10: handlers IPC y puente al renderer

**Files:**
- Modify: `electron-app/main/ipc.js`
- Modify: `electron-app/preload.js`

Sin test automático: `ipc.js` importa `electron` y los tests corren en Node pelado. La lógica ya está probada en Tasks 2-9; aquí sólo se cablea. Se verifica a mano en Task 13.

- [ ] **Step 1: Importa y cablea en `main/ipc.js`**

Cambia la línea 3 y añade los imports nuevos:

```js
const { app, ipcMain, dialog, safeStorage, shell } = require('electron');
```

```js
const { createAccountStore } = require('./github/account');
const { createGitAuth } = require('./github/git-auth');
const { requestDeviceCode, pollForToken } = require('./github/device-flow');
const { fetchIdentity } = require('./github/identity');
const { readGithubConfig } = require('./github/config');
```

Dentro de `registerIpc`, reemplaza la línea 30 (`const projects = createProjectManager(...)`) por:

```js
  // safeStorage sólo funciona tras app.whenReady(); registerIpc ya se llama ahí.
  const account = createAccountStore({ store, safeStorage });
  const auth = createGitAuth(() => account.load()?.token || null);
  const projects = createProjectManager({ projectsDir: path.join(userData, 'projects'), auth });
  let currentDeviceFlow = null;
```

- [ ] **Step 2: Añade los handlers**

Justo antes del bloque `/* ---------- ventana ---------- */`:

```js
  /* ---------- cuenta de GitHub ---------- */
  ipcMain.handle('github:status', async () => {
    const saved = account.load();
    if (!saved) return { connected: false };
    try {
      const identity = await fetchIdentity({ token: saved.token });
      account.saveIdentity(identity);
      return { connected: true, ...identity };
    } catch (err) {
      if (err.code === 'GITHUB_TOKEN_INVALID') {
        account.clear();
        return { connected: false, reason: 'EXPIRED' };
      }
      // Sin red: sigue conectada, con lo último que supimos de ella.
      return { connected: true, ...(saved.identity || {}), stale: true };
    }
  });

  ipcMain.handle('github:connect', async (event) => {
    const { clientId, scope } = readGithubConfig();
    if (!clientId) {
      return { ok: false, code: 'GITHUB_NOT_CONFIGURED', error: 'La app todavía no tiene configurada la conexión con GitHub. Avisa al equipo.' };
    }
    if (currentDeviceFlow) {
      return { ok: false, code: 'GITHUB_CONNECT_IN_PROGRESS', error: 'Ya hay una conexión en curso.' };
    }
    const controller = new AbortController();
    currentDeviceFlow = controller;
    try {
      const device = await requestDeviceCode({ clientId, scope });
      event.sender.send('github:deviceCode', { userCode: device.userCode, verificationUri: device.verificationUri });
      await shell.openExternal(device.verificationUri);
      const token = await pollForToken({
        clientId,
        deviceCode: device.deviceCode,
        interval: device.interval,
        expiresIn: device.expiresIn,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        signal: controller.signal,
      });
      const identity = await fetchIdentity({ token });
      account.save(token, identity);
      return { ok: true, account: identity };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    } finally {
      currentDeviceFlow = null;
    }
  });

  ipcMain.handle('github:cancelConnect', () => {
    currentDeviceFlow?.abort();
    return { ok: true };
  });

  ipcMain.handle('github:disconnect', () => {
    account.clear();
    return { ok: true };
  });
```

- [ ] **Step 3: Expón el puente en `preload.js`**

Añade dentro de `contextBridge.exposeInMainWorld('qa', {...})`, tras el bloque de perfiles:

```js
  // cuenta de GitHub
  getGithubStatus: () => ipcRenderer.invoke('github:status'),
  connectGithub: () => ipcRenderer.invoke('github:connect'),
  cancelGithubConnect: () => ipcRenderer.invoke('github:cancelConnect'),
  disconnectGithub: () => ipcRenderer.invoke('github:disconnect'),
  onGithubDeviceCode: (cb) => ipcRenderer.on('github:deviceCode', (_e, data) => cb(data)),
```

- [ ] **Step 4: Verifica que la app arranca**

Run: `cd electron-app && env -u ELECTRON_RUN_AS_NODE npm start`
Expected: la ventana abre sin errores en consola. (`ELECTRON_RUN_AS_NODE` viene puesto por la terminal de VS Code y hace que Electron corra como Node pelado; sin desactivarlo, `main.js` peta en `app.whenReady`.)

- [ ] **Step 5: Commit**

```bash
git add electron-app/main/ipc.js electron-app/preload.js
git commit -m "feat(github): handlers IPC de conectar, desconectar y estado"
```

---

### Task 11: el estado sale en el perfil

**Files:**
- Modify: `electron-app/renderer/index.html:68-77`
- Modify: `electron-app/renderer/styles.css`
- Modify: `electron-app/renderer/renderer.js`

- [ ] **Step 1: Marca en el HTML**

Reemplaza el bloque `profile-switcher` (líneas 68-77) por:

```html
      <div class="profile-switcher" id="profile-switcher">
        <div class="profile-menu" id="profile-menu" hidden></div>
        <div class="github-warning" id="github-warning" hidden></div>
        <div class="profile-row" id="profile-trigger">
          <div class="avatar" id="profile-avatar">··<span class="github-dot" id="github-dot"></span></div>
          <div class="profile-text">
            <div class="profile-name" id="profile-name">Sin perfil</div>
            <div class="profile-role" id="profile-role">Elige un perfil</div>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Estilos**

Añade al final de la sección `/* ---- selector de perfil de QA ---- */` de `styles.css`:

```css
.avatar { position: relative; }
.github-dot {
  position: absolute; right: -2px; bottom: -2px;
  width: 9px; height: 9px; border-radius: 50%;
  border: 2px solid #fff; background: #94a3b8;
}
.github-dot.connected { background: #16a34a; }
.github-warning {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 9px; margin-bottom: 6px;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
  cursor: pointer;
}
.github-warning[hidden] { display: none; }
.github-warning .title { font-size: 11.5px; font-weight: 700; color: #92400e; }
.github-warning .action { font-size: 11px; font-weight: 600; color: #b45309; text-decoration: underline; }
.profile-menu-sep { height: 1px; background: #e8eef7; margin: 6px 0; }
```

- [ ] **Step 3: Estado y render en `renderer.js`**

Añade a `state` (tras `profileMenuOpen: false,`):

```js
  github: { connected: false },
  githubDevice: null,     // { userCode, verificationUri } mientras se conecta
  githubError: null,
```

Añade la carga, tras la función `loadProfiles()`:

```js
async function loadGithubStatus() {
  state.github = await api.getGithubStatus();
  renderProfileSwitcher();
  renderSidebarStatus();
}
```

**Nota:** repinta sólo el sidebar, no `renderScreen()`. En el arranque esto
corre antes de que haya proyecto cargado, y `renderScreen()` daría por hecho un
`state.project` que todavía no existe. `renderSidebarStatus()` sí es seguro: ya
sale por la puerta de atrás cuando `state.project` es `null` (`renderer.js:239`).

Reemplaza `renderProfileSwitcher()` entero:

```js
function renderProfileSwitcher() {
  const active = state.profiles.find((p) => p.id === state.profile);
  document.getElementById('profile-avatar').firstChild.textContent = active ? initials(active.name) : '··';
  document.getElementById('profile-name').textContent = active ? active.name : 'Sin perfil';
  document.getElementById('profile-role').textContent = active ? active.role : 'Elige un perfil';

  document.getElementById('github-dot').className = `github-dot${state.github.connected ? ' connected' : ''}`;

  const warning = document.getElementById('github-warning');
  warning.hidden = state.github.connected;
  warning.innerHTML = `<div class="title">⚠ Sin cuenta conectada</div><div class="action">Conectar cuenta</div>`;
  warning.onclick = (e) => { e.stopPropagation(); openGithubModal(); };

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

  const separator = document.createElement('div');
  separator.className = 'profile-menu-sep';
  menu.appendChild(separator);

  const githubRow = document.createElement('div');
  githubRow.className = 'profile-menu-item';
  githubRow.innerHTML = state.github.connected
    ? `<div style="flex:1;min-width:0;"><div class="label">Desconectar cuenta</div><div class="sub">Conectado como ${state.github.login || ''}</div></div>`
    : `<div style="flex:1;min-width:0;"><div class="label">Conectar cuenta de GitHub</div><div class="sub">Necesaria para traer las pruebas</div></div>`;
  githubRow.onclick = (e) => {
    e.stopPropagation();
    state.profileMenuOpen = false;
    if (state.github.connected) openGithubDisconnectModal();
    else openGithubModal();
  };
  menu.appendChild(githubRow);
}
```

**Nota:** `firstChild.textContent` en vez de `textContent` porque el avatar ahora contiene el `<span>` del punto; usar `textContent` lo borraría.

- [ ] **Step 4: Cárgalo al arrancar**

En `init()`, tras `wireApiEvents();`, añade:

```js
  await loadGithubStatus();
```

- [ ] **Step 5: Verifica a mano (sólo mirando, sin pulsar)**

Run: `cd electron-app && env -u ELECTRON_RUN_AS_NODE npm start`
Expected: sin cuenta conectada, el punto del avatar es gris y sale la franja ámbar "Sin cuenta conectada". El menú de perfil muestra "Conectar cuenta de GitHub" al final.

**No pulses todavía la franja ni esa fila:** `openGithubModal()` y
`openGithubDisconnectModal()` se crean en la Task 12, así que hasta entonces el
clic lanza un `ReferenceError` en la consola. Esta task deja el estado visible;
la siguiente lo hace accionable.

- [ ] **Step 6: Commit**

```bash
git add electron-app/renderer/index.html electron-app/renderer/styles.css electron-app/renderer/renderer.js
git commit -m "feat(renderer): estado de la cuenta de GitHub en el perfil"
```

---

### Task 12: modales de conectar y desconectar

**Files:**
- Modify: `electron-app/renderer/renderer.js`

- [ ] **Step 1: Escucha el código del device flow**

En `wireApiEvents()`, añade:

```js
  api.onGithubDeviceCode((device) => {
    state.githubDevice = device;
    renderGithubModal();
  });
```

- [ ] **Step 2: El modal de conectar**

Añade junto a `openProjectModal()`:

```js
function openGithubModal() {
  state.githubDevice = null;
  state.githubError = null;
  $overlay.hidden = false;
  renderGithubModal();
  api.connectGithub().then((result) => {
    if (result.ok) {
      closeModal();
      loadGithubStatus();
      return;
    }
    if (result.code === 'GITHUB_CONNECT_CANCELLED') return;
    state.githubError = result.error || 'No fue posible conectar la cuenta.';
    renderGithubModal();
  });
}

function renderGithubModal() {
  if ($overlay.hidden) return;
  const device = state.githubDevice;
  $overlay.innerHTML = `<div class="modal" style="width:460px"><div class="modal-pad">
    <div class="modal-title">Conectar tu cuenta de GitHub</div>
    <div class="modal-sub">La app necesita tu cuenta para traer las pruebas del equipo.</div>
    ${device ? `
      <div style="margin-top:20px;font-size:13px">1. Copia este código:</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
        <div style="flex:1;text-align:center;padding:14px;border:1px dashed #cbd5e1;border-radius:8px;font-size:22px;font-weight:700;letter-spacing:3px">${device.userCode}</div>
        <button class="btn btn-secondary" id="github-copy">Copiar</button>
      </div>
      <div style="margin-top:14px;font-size:13px">2. Apruébalo en GitHub, que se abrirá en tu navegador.</div>
      <div style="margin-top:16px;font-size:12px;color:#64748b">Esperando tu aprobación…</div>
    ` : `<div style="margin-top:24px;font-size:13px;color:#64748b">Pidiendo el código a GitHub…</div>`}
    ${state.githubError ? `<div style="margin-top:12px;color:#b91c1c;font-size:12px">${state.githubError}</div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-secondary" id="github-cancel">Cancelar</button>
      ${device ? `<button class="btn btn-primary" id="github-open">Abrir GitHub</button>` : ''}
    </div>
  </div></div>`;

  document.getElementById('github-cancel').onclick = async () => {
    await api.cancelGithubConnect();
    closeModal();
  };
  if (device) {
    document.getElementById('github-copy').onclick = () => navigator.clipboard.writeText(device.userCode);
    document.getElementById('github-open').onclick = () => window.open(device.verificationUri, '_blank');
  }
}
```

- [ ] **Step 3: El modal de desconectar**

```js
function openGithubDisconnectModal() {
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:460px"><div class="modal-pad">
    <div class="modal-title">Desconectar tu cuenta</div>
    <div class="modal-sub">Se olvidará tu cuenta en este equipo y no podrás traer ni actualizar proyectos hasta conectarla otra vez.</div>
    <div style="margin-top:16px;font-size:12px;color:#64748b">
      Tu cuenta seguirá autorizada en GitHub. Para quitarle el permiso del todo, entra a
      <span style="color:#2563eb">github.com/settings/applications</span>.
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="github-disconnect-cancel">Cancelar</button>
      <button class="btn btn-primary" id="github-disconnect-confirm">Desconectar</button>
    </div>
  </div></div>`;
  document.getElementById('github-disconnect-cancel').onclick = () => closeModal();
  document.getElementById('github-disconnect-confirm').onclick = async () => {
    await api.disconnectGithub();
    closeModal();
    await loadGithubStatus();
  };
}
```

**Nota de copy:** el modal dice explícitamente que la cuenta sigue autorizada en GitHub. Desconectar sólo borra el token de este PC; revocarlo de verdad exige el secreto de la OAuth App, que una app de escritorio no puede custodiar. El texto no promete lo que no hace.

- [ ] **Step 4: Añade el stub de navegador**

En `createBrowserStub()`, junto a `selectProfile`:

```js
    async getGithubStatus() { return { connected: true, login: 'maria-gomez', name: 'María Gómez' }; },
    async connectGithub() { return { ok: true, account: { login: 'maria-gomez' } }; },
    async cancelGithubConnect() { return { ok: true }; },
    async disconnectGithub() { return { ok: true }; },
    onGithubDeviceCode() {},
```

- [ ] **Step 5: Verifica a mano**

Run: `cd electron-app && env -u ELECTRON_RUN_AS_NODE npm start`
Expected: pulsar "Conectar cuenta" abre el modal. Sin `QA_GITHUB_CLIENT_ID` puesto, sale el error "La app todavía no tiene configurada la conexión con GitHub" — que es la respuesta correcta hasta tener el `client_id`.

- [ ] **Step 6: Commit**

```bash
git add electron-app/renderer/renderer.js
git commit -m "feat(renderer): modales de conectar y desconectar la cuenta"
```

---

### Task 13: sin cuenta se bloquea lo que necesita el repositorio

**Files:**
- Modify: `electron-app/renderer/renderer.js`

- [ ] **Step 1: Un único punto de verdad**

Añade junto a `loadGithubStatus()`:

```js
/** Todo lo que va al repositorio necesita cuenta; lo local (historial, resultados) no. */
function needsGithub() {
  return !state.github.connected;
}
```

- [ ] **Step 2: Bloquea el modal de proyecto**

En `openProjectModal()`, como primera línea del cuerpo:

```js
  if (needsGithub()) { openGithubModal(); return; }
```

- [ ] **Step 3: Bloquea la pantalla vacía y la píldora de sync**

En `renderEmptyProject()`, reemplaza el `onclick` del botón:

```js
  document.getElementById('btn-init-project').onclick = () => {
    if (needsGithub()) { openGithubModal(); return; }
    openProjectModal();
  };
```

En `renderSidebarStatus()`, como primera comprobación tras coger el elemento:

```js
  if (needsGithub()) {
    el.className = 'sync-pill';
    el.innerHTML = '<span class="txt">Conecta tu cuenta para actualizar</span>';
    el.onclick = () => openGithubModal();
    return;
  }
```

- [ ] **Step 4: Bloquea la ejecución**

En `openRunOptions(target)` (`renderer.js:479`), como primera línea del cuerpo,
antes de `state.runTarget = target;`:

```js
function openRunOptions(target) {
  if (needsGithub()) { openGithubModal(); return; }
  state.runTarget = target;
  state.showRunOptionsModal = true;
```

Es el único punto de entrada de los dos botones de ejecutar
(`btn-run-selected` y `btn-run-all`, cableados en `renderer.js:343-344`), así
que basta con cortarlo aquí.

- [ ] **Step 5: Verifica a mano**

Run: `cd electron-app && env -u ELECTRON_RUN_AS_NODE npm start`
Expected: sin cuenta, "Inicializar proyecto" y la píldora de sync llevan al modal de conectar en vez de fallar con un error de git. El historial sigue abriéndose.

- [ ] **Step 6: Commit**

```bash
git add electron-app/renderer/renderer.js
git commit -m "feat(renderer): pedir cuenta antes de las acciones que van al repositorio"
```

---

### Task 14: suite completa y README

**Files:**
- Modify: `electron-app/README.md`

- [ ] **Step 1: Corre toda la suite**

Run: `cd electron-app && npm test`
Expected: PASS, sin tests saltados.

- [ ] **Step 2: Documenta la cuenta en el README**

Añade tras la sección "Cómo correrla":

```markdown
## Cuenta de GitHub

Los repositorios de pruebas son privados, así que la app necesita la cuenta de
GitHub del QA para traerlos. Se conecta desde el perfil del sidebar: la app
muestra un código, lo apruebas en github.com y listo. El token se guarda cifrado
con `safeStorage` (DPAPI en Windows, atado a tu cuenta de Windows) y nunca se
escribe en claro ni queda en el `.git/config` del repositorio.

Para desarrollo hace falta el `client_id` de la OAuth App de la organización:

```
QA_GITHUB_CLIENT_ID=Iv1.xxxx npm start
```

Sin esa variable, conectar la cuenta responde que la app no está configurada.

Desconectar sólo olvida la cuenta en ese equipo; para revocar el permiso de
verdad hay que entrar a github.com/settings/applications.
```

- [ ] **Step 3: Commit**

```bash
git add electron-app/README.md
git commit -m "docs: cómo se conecta la cuenta de GitHub"
```

---

## Verificación manual end-to-end (requiere el `client_id`)

Bloqueada hasta que la organización registre la OAuth App. Con
`QA_GITHUB_CLIENT_ID` puesto:

1. Sin cuenta: franja ámbar, punto gris, "Inicializar proyecto" lleva a conectar.
2. Conectar: sale el código, se abre GitHub, al aprobar el perfil pasa a verde con el nombre real.
3. Cerrar y reabrir: sigue conectada.
4. Traer un repo privado con acceso: funciona.
5. Traer uno sin acceso: sale `REPOSITORY_ACCESS_DENIED`, no el `stderr` de git.
6. Desconectar: confirma, avisa de que sigue autorizada en GitHub, vuelve a 1.
7. Sin internet: sigue diciendo "conectado" con el nombre cacheado.
8. Revocar en GitHub y actualizar: detecta el 401, borra el token, pasa a desconectado.
9. `%APPDATA%/qa-test-runner/config.json` no contiene el token en claro.
