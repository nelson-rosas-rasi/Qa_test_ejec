# Configuración (Spec B) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir una pantalla "Configuración" a RunQA para editar/eliminar/añadir perfiles del proyecto, ver/editar la URL del webhook de n8n y abrir la carpeta del repo clonado.

**Architecture:** Handlers de IPC delgados en `main/ipc.js` que delegan la única lógica de negocio nueva (qué perfil queda activo tras guardar, si un perfil se puede eliminar) a un módulo puro `main/profiles/decide.js` cubierto con `node:test`. El renderer añade una pantalla `renderConfig()` y generaliza el modal de perfil existente a crear/editar; se verifica con smoke manual (no hay tests de UI en el repo).

**Tech Stack:** Electron 30, Node `node:test`, HTML/CSS/JS a mano (sin framework), `safeStorage` para perfiles cifrados.

## Global Constraints

- **NO commitear ni subir nada.** Trabajar solo en el working tree. El usuario maneja su propio git. Para revisar cambios, usar snapshots (copiar antes/después + `diff -u`), no `git diff`.
- Ejecutar la suite con `npm test` (`node --test "test/*.test.js"`) desde `Qa_test_ejec/electron-app`. Estado base: **135/135 en verde**; ninguna tarea debe romper tests existentes.
- Los tests nuevos siguen el estilo del repo: `node:test` + `node:assert/strict`, directorios temporales con `fs.mkdtempSync`, fakes inyectados (p. ej. `fakeSafeStorage`).
- No filtrar `repoPath` al renderer (patrón `publicProject`): la carpeta se abre desde el main.
- Textos de UI en español, consistentes con el resto de la app.
- La pantalla Configuración refleja el **proyecto seleccionado** (`state.project`), como el resto de la app.

**Rutas base:** todos los paths son relativos a `Qa_test_ejec/electron-app/`.

---

### Task 1: Módulo de reglas de perfiles (`profiles/decide.js`)

Lógica pura y testeable que consumirán los handlers de IPC: si se puede eliminar un perfil y qué perfil queda activo tras guardar.

**Files:**
- Create: `main/profiles/decide.js`
- Test: `test/profiles-decide.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `canRemoveProfile(activeId, id) -> boolean` — `false` si `id === activeId`.
  - `nextActiveAfterSave({ isNew, currentActive, savedId }) -> string|null` — `savedId` si `isNew`, si no `currentActive`.

- [ ] **Step 1: Escribir el test que falla**

Create `test/profiles-decide.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { canRemoveProfile, nextActiveAfterSave } = require('../main/profiles/decide');

test('canRemoveProfile: el perfil activo no se puede eliminar', () => {
  assert.equal(canRemoveProfile('ana', 'ana'), false);
});

test('canRemoveProfile: un perfil no activo sí se puede eliminar', () => {
  assert.equal(canRemoveProfile('ana', 'luis'), true);
});

test('canRemoveProfile: sin perfil activo, cualquiera se puede eliminar', () => {
  assert.equal(canRemoveProfile(null, 'luis'), true);
});

test('nextActiveAfterSave: crear activa el nuevo perfil', () => {
  assert.equal(nextActiveAfterSave({ isNew: true, currentActive: 'ana', savedId: 'luis' }), 'luis');
});

test('nextActiveAfterSave: crear el primer perfil lo activa', () => {
  assert.equal(nextActiveAfterSave({ isNew: true, currentActive: null, savedId: 'ana' }), 'ana');
});

test('nextActiveAfterSave: editar el activo conserva el activo', () => {
  assert.equal(nextActiveAfterSave({ isNew: false, currentActive: 'ana', savedId: 'ana' }), 'ana');
});

test('nextActiveAfterSave: editar un perfil no activo no cambia el activo', () => {
  assert.equal(nextActiveAfterSave({ isNew: false, currentActive: 'ana', savedId: 'luis' }), 'ana');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- --test-name-pattern="canRemoveProfile|nextActiveAfterSave"` (o `npm test`)
Expected: FAIL — `Cannot find module '../main/profiles/decide'`.

- [ ] **Step 3: Escribir la implementación mínima**

Create `main/profiles/decide.js`:

```js
/**
 * Reglas de negocio de perfiles, puras y testeables. Los handlers de IPC son
 * delgados y delegan aquí las decisiones (qué perfil queda activo, si se puede
 * eliminar), para poder cubrirlas con node:test sin arrancar Electron.
 */

/** No se puede eliminar el perfil activo: hay que activar otro primero. */
function canRemoveProfile(activeId, id) {
  return id !== activeId;
}

/**
 * Qué perfil queda activo tras guardar. Al crear (isNew) se activa el recién
 * guardado, como hasta ahora. Al editar se conserva el activo actual.
 */
function nextActiveAfterSave({ isNew, currentActive, savedId }) {
  return isNew ? savedId : currentActive;
}

module.exports = { canRemoveProfile, nextActiveAfterSave };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS — todos los tests nuevos verdes y los 135 previos siguen verdes.

- [ ] **Step 5: Verificar working tree (sin commitear)**

Run: `git status --short` (solo para inspeccionar; **no** `git add`/`git commit`).
Expected: aparecen `main/profiles/decide.js` y `test/profiles-decide.test.js` como cambios sin commitear.

---

### Task 2: IPC + preload de perfiles (get / remove / save editable)

Expone lectura de un perfil, borrado con guarda del activo, y ajusta `profiles:save` para distinguir crear vs editar usando `decide.js`.

**Files:**
- Modify: `main/ipc.js` (imports arriba; sección `/* ---------- perfiles ---------- */`, aprox. líneas 218-247)
- Modify: `preload.js` (bloque `// perfiles de QA`, aprox. líneas 21-27)

**Interfaces:**
- Consumes: `canRemoveProfile`, `nextActiveAfterSave` de Task 1; `profileStore.load/save/remove/list`, `store.getProject/setProject`, `materializeActive`, `uniqueProjectId` (ya existentes).
- Produces (IPC → renderer):
  - `profiles:get(projectId, id) -> { ok:true, values } | { ok:false, code:'PROFILE_NOT_FOUND', error }`
  - `profiles:remove(projectId, id) -> { ok:true } | { ok:false, code:'PROFILE_ACTIVE', error }`
  - `profiles:save(projectId, id|null, values) -> { ok:true, profile:{id,name,role} } | { ok:false, error, code }` (crear activa el nuevo; editar conserva el activo)
  - `window.qa.getProfile(projectId, id)`, `window.qa.removeProfile(projectId, id)`

- [ ] **Step 1: Importar el módulo de reglas en `ipc.js`**

En `main/ipc.js`, junto a los demás `require` de la parte superior (después de la línea `const { createProfileStore } = require('./profiles/store');`), añadir:

```js
const { canRemoveProfile, nextActiveAfterSave } = require('./profiles/decide');
```

- [ ] **Step 2: Reemplazar el handler `profiles:save` y añadir `profiles:get` y `profiles:remove`**

En `main/ipc.js`, dentro de la sección `/* ---------- perfiles ---------- */`, **reemplazar** el handler actual `ipcMain.handle('profiles:save', ...)` por este bloque (deja intactos `profiles:list`, `profiles:schema`, `profiles:active`, `profiles:select`):

```js
  ipcMain.handle('profiles:get', (_event, projectId, id) => {
    const values = profileStore.load(projectId, id);
    if (!values) return { ok: false, code: 'PROFILE_NOT_FOUND', error: 'No se pudo cargar el perfil.' };
    return { ok: true, values };
  });

  ipcMain.handle('profiles:save', (_event, projectId, id, values) => {
    try {
      const isNew = !id;
      const finalId = id || uniqueProjectId(values.QA_NOMBRE || 'perfil', new Set(profileStore.list(projectId).map((p) => p.id)));
      profileStore.save(projectId, finalId, values);
      const currentActive = store.getProject(projectId).profile || null;
      const active = nextActiveAfterSave({ isNew, currentActive, savedId: finalId });
      store.setProject(projectId, { profile: active });
      if (active === finalId) materializeActive(projectId);
      return { ok: true, profile: { id: finalId, name: values.QA_NOMBRE || finalId, role: values.QA_CARGO || 'QA' } };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    }
  });

  ipcMain.handle('profiles:remove', (_event, projectId, id) => {
    const active = store.getProject(projectId).profile || null;
    if (!canRemoveProfile(active, id)) {
      return { ok: false, code: 'PROFILE_ACTIVE', error: 'Activa otro perfil primero para poder eliminar este.' };
    }
    profileStore.remove(projectId, id);
    return { ok: true };
  });
```

- [ ] **Step 3: Exponer los métodos en `preload.js`**

En `preload.js`, dentro del objeto de `contextBridge.exposeInMainWorld('qa', { ... })`, en el bloque `// perfiles de QA`, añadir dos líneas después de `saveProfile`:

```js
  getProfile: (projectId, id) => ipcRenderer.invoke('profiles:get', projectId, id),
  removeProfile: (projectId, id) => ipcRenderer.invoke('profiles:remove', projectId, id),
```

- [ ] **Step 4: Verificar que no se rompió nada**

Run: `npm test`
Expected: PASS — 135/135 + los de Task 1 siguen verdes (estos handlers no tienen test unitario propio; su lógica vive en `decide.js`, ya cubierto).

- [ ] **Step 5: Revisión estática rápida**

Run: `node -e "require('./main/profiles/decide'); require('./preload.js')" 2>&1 | head` desde `electron-app/`.
Nota: `preload.js` importa `electron`, que fuera de Electron lanza; basta comprobar que `decide.js` carga sin error de sintaxis y revisar a ojo el diff de `ipc.js`/`preload.js`. **No commitear.**

---

### Task 3: IPC + preload de ajustes del proyecto (n8n y abrir carpeta)

Lectura/escritura de la URL de n8n del proyecto y apertura de la carpeta del repo.

**Files:**
- Modify: `main/ipc.js` (nueva sección `/* ---------- configuración del proyecto ---------- */`, tras la sección de perfiles; usa `fs` y `shell` ya importados arriba)
- Modify: `preload.js` (nuevo bloque)

**Interfaces:**
- Consumes: `store.getProject/setProject`, `profileStore.load`, `fs.existsSync`, `shell.openPath` (ya existentes).
- Produces (IPC → renderer):
  - `config:get(projectId) -> { n8nWebhookUrl:string, n8nProfileFallback:string|null, hasRepo:boolean }`
  - `config:setN8n(projectId, url) -> { ok:true, n8nWebhookUrl:string }`
  - `projects:openFolder(projectId) -> { ok:true } | { ok:false, error }`
  - `window.qa.getProjectConfig(projectId)`, `window.qa.setN8nUrl(projectId, url)`, `window.qa.openProjectFolder(projectId)`

- [ ] **Step 1: Añadir los tres handlers en `ipc.js`**

En `main/ipc.js`, después de la sección de perfiles (tras el handler `profiles:remove`) y antes de `/* ---------- ejecución ---------- */`, añadir:

```js
  /* ---------- configuración del proyecto ---------- */
  ipcMain.handle('config:get', (_event, projectId) => {
    const project = store.getProject(projectId);
    const values = project.profile ? profileStore.load(projectId, project.profile) : null;
    return {
      n8nWebhookUrl: project.n8nWebhookUrl || '',
      n8nProfileFallback: (values && values.N8N_WEBHOOK_URL) || null,
      hasRepo: !!(project.repoPath && fs.existsSync(project.repoPath)),
    };
  });

  ipcMain.handle('config:setN8n', (_event, projectId, url) => {
    const value = String(url || '').trim();
    store.setProject(projectId, { n8nWebhookUrl: value });
    return { ok: true, n8nWebhookUrl: value };
  });

  ipcMain.handle('projects:openFolder', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project.repoPath || !fs.existsSync(project.repoPath)) {
      return { ok: false, error: 'No se encontró la carpeta del repositorio.' };
    }
    const err = await shell.openPath(project.repoPath);
    return err ? { ok: false, error: err } : { ok: true };
  });
```

- [ ] **Step 2: Exponer los métodos en `preload.js`**

En `preload.js`, dentro del objeto `qa`, añadir un bloque nuevo (p. ej. justo antes de `// resultados guardados`):

```js
  // configuración del proyecto
  getProjectConfig: (projectId) => ipcRenderer.invoke('config:get', projectId),
  setN8nUrl: (projectId, url) => ipcRenderer.invoke('config:setN8n', projectId, url),
  openProjectFolder: (projectId) => ipcRenderer.invoke('projects:openFolder', projectId),
```

- [ ] **Step 3: Verificar que no se rompió nada**

Run: `npm test`
Expected: PASS — 135/135 + Task 1 verdes.

- [ ] **Step 4: Revisión estática**

Revisar a ojo el diff de `ipc.js`/`preload.js`; confirmar que `config:get` **no** devuelve `repoPath`. **No commitear.**

---

### Task 4: Pantalla Configuración — scaffold, sección Proyecto y "Añadir perfil"

Añade el ítem de navegación, la pantalla con la lista de perfiles (solo lectura + botón Añadir que reusa el modal de creación existente) y la sección Proyecto (n8n + abrir carpeta) totalmente funcional.

**Files:**
- Modify: `renderer/index.html` (nav, tras el `nav-item` de `results`, aprox. línea 57)
- Modify: `renderer/renderer.js` (router `renderScreen` aprox. línea 346-348; añadir `renderConfig`)
- Modify: `renderer/styles.css` (añadir bloque al final)

**Interfaces:**
- Consumes: `api.getProjectConfig`, `api.setN8nUrl`, `api.openProjectFolder` (Task 3); `state.profiles`, `state.profile`, `escapeHtml`, `projectSuite`, `currentProject`, `openProfileModal` (existentes).
- Produces: `renderConfig()`; ganchos DOM `data-edit`/`data-del` que Task 5 cablea (`openProfileModal(id)` / `openDeleteProfileModal(id)`).

- [ ] **Step 1: Añadir el ítem de navegación**

En `renderer/index.html`, dentro de `<nav class="nav">`, justo después del `<div class="nav-item" data-screen="results"> ... </div>`, añadir:

```html
        <div class="nav-item" data-screen="config">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>Configuración</span>
        </div>
```

- [ ] **Step 2: Enrutar `config` en `renderScreen()`**

En `renderer/renderer.js`, en `renderScreen()`, junto a las otras ramas de pantalla:

```js
  else if (state.screen === 'results') renderResults();
```

añadir debajo:

```js
  else if (state.screen === 'config') renderConfig();
```

- [ ] **Step 3: Implementar `renderConfig()`**

En `renderer/renderer.js`, añadir esta función (p. ej. después de `renderResults` / antes de los helpers de resultados). Los ganchos `data-edit`/`data-del` se cablean en Task 5; aquí el botón Eliminar del activo va deshabilitado y los handlers de edición/borrado se asignan a funciones que Task 5 define:

```js
async function renderConfig() {
  const cfg = await api.getProjectConfig(state.project);
  const profiles = state.profiles;
  const active = state.profile;

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div class="screen-title">Configuración</div>
        <div class="screen-subtitle">Perfiles y ajustes de ${escapeHtml(projectSuite(currentProject()))}.</div>
      </div>
      <div class="config-body">
        <div class="config-section-title">Perfiles</div>
        <div class="card" id="config-profiles"></div>
        <button class="btn btn-secondary btn-sm" id="config-add-profile" style="margin-top:12px">+ Añadir perfil</button>

        <div class="config-section-title" style="margin-top:26px">Proyecto</div>
        <div class="card">
          <div class="config-label">Documentación (n8n) — URL del webhook</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input id="config-n8n" type="text" value="${escapeHtml(cfg.n8nWebhookUrl)}" placeholder="https://n8n.tu-servidor/webhook/..." style="flex:1;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
            <button class="btn btn-primary btn-sm" id="config-n8n-save">Guardar</button>
          </div>
          <div class="config-hint">${
            cfg.n8nProfileFallback
              ? `Si lo dejas vacío se usa la del perfil activo:<br><span style="color:var(--muted)">${escapeHtml(cfg.n8nProfileFallback)}</span>`
              : 'Si lo dejas vacío y el perfil activo no trae una, no se generará documentación.'
          }</div>
          <div id="config-n8n-status" class="config-hint" style="color:var(--green-dark)"></div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="config-label">Repositorio</div>
          <button class="btn btn-secondary btn-sm" id="config-open-folder" style="margin-top:10px" ${cfg.hasRepo ? '' : 'disabled'}>Abrir carpeta del repo</button>
          <div id="config-repo-status" class="config-hint" style="color:var(--red-dark)">${cfg.hasRepo ? '' : 'La carpeta del repositorio no está disponible.'}</div>
        </div>
      </div>
    </div>`;

  const list = document.getElementById('config-profiles');
  if (profiles.length === 0) {
    list.innerHTML = `<div class="config-hint" style="margin:0">Este proyecto todavía no tiene perfiles.</div>`;
  } else {
    list.innerHTML = '';
    profiles.forEach((p) => {
      const isActive = p.id === active;
      const row = document.createElement('div');
      row.className = 'config-profile-row';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="config-profile-name">${escapeHtml(p.name)} · ${escapeHtml(p.role)}</div>
          ${isActive ? '<div class="config-profile-active">● activo</div>' : ''}
        </div>
        <button class="btn btn-secondary btn-sm" data-edit="${escapeHtml(p.id)}">Editar</button>
        <button class="btn btn-secondary btn-sm" data-del="${escapeHtml(p.id)}"${isActive ? ' disabled title="Activa otro perfil primero para poder eliminarlo"' : ''}>Eliminar</button>`;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-edit]').forEach((el) => { el.onclick = () => openProfileModal(el.dataset.edit); });
    list.querySelectorAll('[data-del]').forEach((el) => { el.onclick = () => openDeleteProfileModal(el.dataset.del); });
  }

  document.getElementById('config-add-profile').onclick = () => openProfileModal();

  document.getElementById('config-n8n-save').onclick = async () => {
    await api.setN8nUrl(state.project, document.getElementById('config-n8n').value);
    const status = document.getElementById('config-n8n-status');
    status.textContent = 'Guardado.';
    setTimeout(() => { if (document.body.contains(status)) status.textContent = ''; }, 2500);
  };

  const openFolder = document.getElementById('config-open-folder');
  if (cfg.hasRepo) {
    openFolder.onclick = async () => {
      const res = await api.openProjectFolder(state.project);
      if (!res.ok) document.getElementById('config-repo-status').textContent = res.error || 'No se pudo abrir la carpeta.';
    };
  }
}
```

Nota: `openProfileModal(el.dataset.edit)` y `openDeleteProfileModal(...)` se completan en Task 5. En Task 4 el botón **Añadir** ya funciona porque `openProfileModal()` (sin argumento) existe hoy en modo creación; **Editar/Eliminar** aún no harán nada útil hasta Task 5.

- [ ] **Step 4: Añadir el CSS**

En `renderer/styles.css`, al final del archivo, añadir:

```css
/* ===== Configuración ===== */
.config-body { flex: 1; overflow: auto; padding: 22px 26px; }
.config-section-title { font-size: 13px; font-weight: 700; color: var(--ink-2); margin-bottom: 10px; }
.config-label { font-size: 12px; font-weight: 700; color: var(--ink-3); }
.config-hint { margin-top: 8px; font-size: 11.5px; color: var(--faint); }
.config-profile-row { display: flex; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--line-2); }
.config-profile-row:first-child { padding-top: 2px; }
.config-profile-row:last-child { border-bottom: none; padding-bottom: 2px; }
.config-profile-name { font-size: 13.5px; font-weight: 600; color: var(--ink-2); }
.config-profile-active { margin-top: 2px; font-size: 11px; font-weight: 600; color: var(--green-dark); }
.btn-sm { font-size: 13px; padding: 8px 14px; }
.btn[disabled] { opacity: .5; cursor: not-allowed; box-shadow: none; }
```

- [ ] **Step 5: Verificación (smoke manual)**

`npm test` debe seguir 135/135 (no toca backend). Smoke manual (requiere display; el entorno del agente no lo tiene, dejar anotado para el usuario): `npm start` → clic en "Configuración" en la navegación → se ve la lista de perfiles con el activo marcado, el campo n8n precargado y su pista, y "Abrir carpeta del repo" abre el explorador. Guardar una URL de n8n y reabrir la pantalla: persiste. **No commitear.**

---

### Task 5: Editar y eliminar perfil (modal generalizado + confirmación)

Generaliza `openProfileModal` a crear/editar y añade el modal de confirmación de borrado, completando los ganchos que dejó Task 4.

**Files:**
- Modify: `renderer/renderer.js` (`openProfileModal`, aprox. líneas 696-747; añadir `openDeleteProfileModal`)

**Interfaces:**
- Consumes: `api.getProfile`, `api.saveProfile`, `api.removeProfile` (Tasks 2); `api.getProfileSchema`, `loadProfiles`, `renderProfileSwitcher`, `closeModal`, `escapeHtml`, `state`, `$overlay`, `SECRET_KEY` (existentes); `renderConfig` (Task 4).
- Produces: `openProfileModal(profileId = null)` (crear si `null`, editar si id); `openDeleteProfileModal(profileId)`.

- [ ] **Step 1: Generalizar `openProfileModal` a crear/editar**

En `renderer/renderer.js`, **reemplazar** la función `openProfileModal` completa (desde `async function openProfileModal() {` hasta su `}` de cierre) por:

```js
async function openProfileModal(profileId = null) {
  const schema = await api.getProfileSchema(state.project);
  if (!schema.ok) {
    $overlay.hidden = false;
    $overlay.innerHTML = `<div class="modal" style="width:440px"><div class="modal-pad">
      <div class="modal-title">No se puede crear el perfil</div>
      <div class="modal-sub" style="margin-top:8px">${schema.error || 'No fue posible leer la configuración del proyecto.'}</div>
      <div class="modal-actions"><button class="btn btn-primary" id="profile-err-close">Entendido</button></div>
    </div></div>`;
    document.getElementById('profile-err-close').onclick = () => closeModal();
    return;
  }
  const fields = schema.fields;

  const editing = !!profileId;
  let saved = {};
  if (editing) {
    const got = await api.getProfile(state.project, profileId);
    if (!got.ok) {
      $overlay.hidden = false;
      $overlay.innerHTML = `<div class="modal" style="width:440px"><div class="modal-pad">
        <div class="modal-title">No se puede editar el perfil</div>
        <div class="modal-sub" style="margin-top:8px">${got.error || 'No se pudo cargar el perfil.'}</div>
        <div class="modal-actions"><button class="btn btn-primary" id="profile-err-close">Entendido</button></div>
      </div></div>`;
      document.getElementById('profile-err-close').onclick = () => closeModal();
      return;
    }
    saved = got.values;
  }
  const valueFor = (f) => (editing && f.key in saved) ? saved[f.key] : f.value;

  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:560px;max-height:82vh;display:flex;flex-direction:column">
    <div class="modal-pad" style="overflow:auto">
      <div class="modal-title">${editing ? 'Editar perfil' : 'Crea tu perfil para este proyecto'}</div>
      <div class="modal-sub">${editing ? 'Actualiza los datos de este perfil.' : 'La app necesita tus datos para ejecutar las pruebas con tu usuario.'}</div>
      <div id="profile-fields" style="margin-top:16px">
        ${fields.map((f, i) => `
          <label style="display:block;margin-top:12px;font-size:12px;font-weight:700">${f.key}</label>
          <input id="pf-${i}" type="${SECRET_KEY.test(f.key) ? 'password' : 'text'}"
                 value="${String(valueFor(f)).replace(/"/g, '&quot;')}"
                 style="width:100%;margin-top:6px;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
          ${f.help ? `<div style="margin-top:4px;font-size:11px;color:#94a3b8">${f.help}</div>` : ''}
        `).join('')}
      </div>
      <div id="profile-error" style="display:none;margin-top:12px;color:#b91c1c;font-size:12px"></div>
    </div>
    <div class="modal-actions" style="padding:14px 20px;border-top:1px solid #eef2f7">
      <button class="btn btn-secondary" id="profile-cancel">Cancelar</button>
      <button class="btn btn-primary" id="profile-save">${editing ? 'Guardar cambios' : 'Guardar perfil'}</button>
    </div>
  </div>`;

  document.getElementById('profile-cancel').onclick = () => closeModal();
  document.getElementById('profile-save').onclick = async () => {
    const values = {};
    fields.forEach((f, i) => { values[f.key] = document.getElementById(`pf-${i}`).value; });
    const result = await api.saveProfile(state.project, profileId, values);
    if (!result.ok) {
      const err = document.getElementById('profile-error');
      err.textContent = result.error || 'No fue posible guardar el perfil.';
      err.style.display = 'block';
      return;
    }
    closeModal();
    await loadProfiles();
    if (state.screen === 'config') renderConfig(); else renderScreen();
  };
}
```

- [ ] **Step 2: Añadir `openDeleteProfileModal`**

En `renderer/renderer.js`, justo después de `openProfileModal`, añadir:

```js
function openDeleteProfileModal(profileId) {
  const p = state.profiles.find((x) => x.id === profileId);
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:460px"><div class="modal-pad">
    <div class="modal-title">Eliminar perfil</div>
    <div class="modal-sub">Se eliminará el perfil ${p ? `«${escapeHtml(p.name)}»` : ''} de este equipo. Esta acción no se puede deshacer.</div>
    <div id="del-profile-error" style="display:none;margin-top:12px;color:#b91c1c;font-size:12px"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="del-profile-cancel">Cancelar</button>
      <button class="btn btn-danger" id="del-profile-confirm">Eliminar</button>
    </div>
  </div></div>`;
  document.getElementById('del-profile-cancel').onclick = () => closeModal();
  document.getElementById('del-profile-confirm').onclick = async () => {
    const res = await api.removeProfile(state.project, profileId);
    if (!res.ok) {
      const err = document.getElementById('del-profile-error');
      err.textContent = res.error || 'No se pudo eliminar el perfil.';
      err.style.display = 'block';
      return;
    }
    closeModal();
    await loadProfiles();
    if (state.screen === 'config') renderConfig(); else renderScreen();
  };
}
```

- [ ] **Step 3: Verificar que el modo creación sigue igual**

Revisar a ojo que las llamadas existentes `openProfileModal()` (en `renderProfileSwitcher` "Añadir perfil", en `renderScreen` "Crear perfil", y en `renderConfig` "Añadir perfil") siguen funcionando con el parámetro por defecto `null` (modo creación intacto).

- [ ] **Step 4: Verificación (smoke manual)**

`npm test` sigue 135/135 (no toca backend). Smoke manual (`npm start`, requiere display — anotar para el usuario):
1. Configuración → Editar un perfil no activo → cambiar el nombre → Guardar cambios → la lista se actualiza y el **perfil activo no cambia**.
2. Editar el perfil **activo** → Guardar → sigue activo y su `.env` se re-materializa (la próxima corrida usa los valores nuevos).
3. Eliminar un perfil no activo → confirmar → desaparece de la lista.
4. El botón Eliminar del perfil **activo** está deshabilitado (tooltip visible).
5. Añadir perfil → se crea y **queda activo** (comportamiento previo).

**No commitear.**

---

## Self-Review

**Cobertura del spec:**
- Nueva pantalla "Configuración" en navegación → Task 4 (index.html + router).
- Editar campos del perfil (formulario completo precargado, renombrar vía QA_NOMBRE) → Task 2 (`profiles:get`, `profiles:save` editable) + Task 5 (modal editable).
- Eliminar perfil con confirmación, activo bloqueado (UI + backend) → Task 1 (`canRemoveProfile`) + Task 2 (`profiles:remove`) + Task 4 (botón deshabilitado) + Task 5 (modal confirmación).
- No reasignar activo al editar / activar el nuevo al crear → Task 1 (`nextActiveAfterSave`) + Task 2 (`profiles:save`).
- URL de n8n editable + respaldo del perfil como pista → Task 3 (`config:get`/`config:setN8n`) + Task 4 (sección Proyecto).
- Abrir carpeta del repo → Task 3 (`projects:openFolder`) + Task 4 (botón).
- Añadir perfil desde Configuración → Task 4 (reusa `openProfileModal()`).
- Errores/borde (PROFILE_ACTIVE, PROFILE_NOT_FOUND, carpeta faltante, n8n trim) → Tasks 2/3/5.
- Testing unit de reglas + regresión → Task 1; smoke manual → Tasks 4/5.

**Placeholders:** ninguno; todos los pasos con código concreto y comandos con salida esperada.

**Consistencia de tipos/nombres:** `canRemoveProfile(activeId, id)` y `nextActiveAfterSave({ isNew, currentActive, savedId })` idénticos en Task 1 (definición), Task 2 (uso) y tests. IPC `profiles:get/remove`, `config:get/setN8n`, `projects:openFolder` y sus wrappers de preload (`getProfile`, `removeProfile`, `getProjectConfig`, `setN8nUrl`, `openProjectFolder`) coinciden entre Tasks 2/3 y su consumo en Tasks 4/5. `openProfileModal(profileId=null)` y `openDeleteProfileModal(profileId)` coinciden entre Task 4 (llamadas) y Task 5 (definición).
