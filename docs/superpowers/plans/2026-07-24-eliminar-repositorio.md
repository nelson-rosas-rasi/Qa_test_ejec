# Eliminar repositorio clonado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir eliminar un repositorio (proyecto) desde su pantalla Configuración, borrando siempre el clon y la ficha, y dejando que el usuario elija conservar o eliminar los datos asociados (perfiles, resultados, grabaciones).

**Architecture:** Handlers de IPC delgados sobre módulos testeables. Cada store (perfiles, resultados, grabaciones, config) gana un `removeProject(projectId)`; el project manager gana `remove(project)` que valida la ruta administrada antes de borrar el clon. Dos handlers nuevos (`projects:removalSummary`, `projects:remove`) orquestan; el renderer añade el botón, el modal de confirmación con checkbox y la transición al siguiente proyecto.

**Tech Stack:** Electron (main + preload + renderer vanilla JS), `node:test` con directorios temporales y fakes inyectados.

## Global Constraints

- Ejecutar la suite con `npm test` (`node --test "test/*.test.js"`) desde `Qa_test_ejec/electron-app`. Estado base: **185/185 en verde**; ninguna tarea debe romper tests existentes.
- **No se commitea.** El working tree ya tiene WIP sin commitear de specs anteriores (Resultados, Configuración, Reporte PDF, Grabaciones) mezclado en `ipc.js`, `preload.js`, `renderer.js`, y `main/results/` + `main/recordings/` son carpetas nuevas sin trackear. Cada tarea cierra ejecutando la suite + inspección del working tree (patrón de los planes hermanos). El commit lo decide el usuario aparte.
- Los tres stores de datos (`profileStore`, `resultsStore`, `recordingsStore`) y el `store` de config ya se instancian en `registerIpc` (`main/ipc.js:49-56`); los handlers nuevos los usan directamente, sin cambios de cableado.
- Opción A ya decidida: **un único checkbox** para conservar/eliminar todo el bloque de datos asociados (no hay grano por tipo).
- Borrado con `fs.rmSync(..., { recursive: true, force: true })`: idempotente (no falla si la carpeta no existe).

## File Structure

- Modify: `main/profiles/store.js` — añadir `removeProject(projectId)`.
- Modify: `main/results/store.js` — añadir `removeProject(projectId)`.
- Modify: `main/recordings/store.js` — añadir `removeProject(projectId)`.
- Modify: `main/config-store.js` — añadir `removeProject(projectId)`.
- Modify: `main/projects.js` — añadir `remove(project)` a `createProjectManager` y exportarlo.
- Modify: `main/ipc.js` — handlers `projects:removalSummary` y `projects:remove`.
- Modify: `preload.js` — wrappers `projectRemovalSummary` y `removeProject`.
- Modify: `renderer/renderer.js` — botón en la tarjeta Repositorio, `openDeleteProjectModal`, `afterRemoval`, stubs offline.
- Test: `test/profile-store.test.js`, `test/results-store.test.js`, `test/recordings-store.test.js`, `test/config-store.test.js`, `test/projects.test.js`.

---

### Task 1: `removeProject` en los tres stores de datos (perfiles, resultados, grabaciones)

Cada uno guarda todo bajo `<dir>/<projectId>/`. `removeProject` borra esa carpeta de un golpe.

**Files:**
- Modify: `main/profiles/store.js` (objeto devuelto, junto a `remove`, ~línea 54)
- Modify: `main/results/store.js` (objeto devuelto, junto a `remove`, ~línea 46)
- Modify: `main/recordings/store.js` (objeto devuelto, junto a `remove`, ~línea 57)
- Test: `test/profile-store.test.js`, `test/results-store.test.js`, `test/recordings-store.test.js`

**Interfaces:**
- Produces: `profileStore.removeProject(projectId)`, `resultsStore.removeProject(projectId)`, `recordingsStore.removeProject(projectId)` — cada uno `void`, idempotente. Todos usan el helper `projectDir(projectId)` que ya existe en su archivo.

- [ ] **Step 1: Escribir los tests que fallan**

En `test/profile-store.test.js`, al final:

```javascript
test('removeProject borra todos los perfiles de ese proyecto y no toca los de otro', () => {
  const dir = tempDir();
  const store = createProfileStore({ dir, safeStorage: fakeSafeStorage() });
  store.save('erp', 'ana-ruiz', values);
  store.save('erp', 'beto-paz', { QA_NOMBRE: 'Beto Paz', QA_CARGO: 'QA' });
  store.save('medical', 'carla', { QA_NOMBRE: 'Carla', QA_CARGO: 'QA' });
  store.removeProject('erp');
  assert.deepEqual(store.list('erp'), []);
  assert.equal(store.list('medical').length, 1);
});

test('removeProject es idempotente si el proyecto no tiene perfiles', () => {
  const store = createProfileStore({ dir: tempDir(), safeStorage: fakeSafeStorage() });
  assert.doesNotThrow(() => store.removeProject('nada'));
});
```

En `test/results-store.test.js`, al final:

```javascript
test('removeProject borra todas las corridas de ese proyecto y no toca las de otro', () => {
  const dir = tempDir();
  const store = createResultsStore({ dir });
  store.save(sampleRecord({ id: 'run-1' }));
  store.save(sampleRecord({ id: 'run-2', projectId: 'otro', projectName: 'Otro' }));
  store.removeProject('erp');
  assert.deepEqual(store.list('erp'), []);
  assert.equal(store.list('otro').length, 1);
});

test('removeProject es idempotente si el proyecto no tiene corridas', () => {
  assert.doesNotThrow(() => createResultsStore({ dir: tempDir() }).removeProject('nada'));
});
```

En `test/recordings-store.test.js`, al final:

```javascript
test('removeProject borra todas las grabaciones de ese proyecto y no toca las de otro', () => {
  const store = createRecordingsStore({ dir: tempDir() });
  withSpec(store, 'erp', 'grab-1', 'Uno');
  withSpec(store, 'otro', 'grab-2', 'Dos');
  store.removeProject('erp');
  assert.deepEqual(store.list('erp'), []);
  assert.equal(store.list('otro').length, 1);
});

test('removeProject es idempotente si el proyecto no tiene grabaciones', () => {
  assert.doesNotThrow(() => createRecordingsStore({ dir: tempDir() }).removeProject('nada'));
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test test/profile-store.test.js test/results-store.test.js test/recordings-store.test.js`
Expected: FAIL — `store.removeProject is not a function` en los tres.

- [ ] **Step 3: Implementar `removeProject` en los tres stores**

En `main/profiles/store.js`, dentro del objeto `return { ... }`, junto a `remove` (después de la línea 56 `remove(projectId, id) { ... },`):

```javascript
    removeProject(projectId) {
      fs.rmSync(projectDir(projectId), { recursive: true, force: true });
    },
```

En `main/results/store.js`, dentro del objeto `return { ... }`, junto a `remove` (después de la línea 49):

```javascript
    removeProject(projectId) {
      fs.rmSync(projectDir(projectId), { recursive: true, force: true });
    },
```

En `main/recordings/store.js`, dentro del objeto `return { ... }`, junto a `remove` (después de la línea 60):

```javascript
    removeProject(projectId) {
      fs.rmSync(projectDir(projectId), { recursive: true, force: true });
    },
```

(Los tres archivos ya definen `const projectDir = (projectId) => path.join(dir, projectId);` y requieren `fs` y `path` arriba.)

- [ ] **Step 4: Correr y verificar que pasan**

Run: `node --test test/profile-store.test.js test/results-store.test.js test/recordings-store.test.js`
Expected: PASS — incluidos los 6 casos nuevos.

- [ ] **Step 5: Suite completa + inspección working tree (sin commitear)**

Run: `npm test`
Expected: PASS — 185 previos + 6 nuevos = 191. Revisar los diffs de los 3 stores y los 3 tests con snapshots antes/después.

---

### Task 2: Borrado del clon y de la ficha (`config-store.removeProject` + `projects.remove`)

Lo que **siempre** se borra: la entrada del proyecto en `config-store` y la carpeta del clon (validando que esté dentro del área administrada).

**Files:**
- Modify: `main/config-store.js` (objeto devuelto, junto a `setProject`, ~línea 50)
- Modify: `main/projects.js` (dentro de `createProjectManager`, y el `return` de la línea 197)
- Test: `test/config-store.test.js`, `test/projects.test.js`

**Interfaces:**
- Consumes: `validateManagedPath(repoPath, projectsDir)` (ya existe, `main/projects.js:41`), `appError(code, message)` (ya importado en `projects.js`).
- Produces:
  - `configStore.removeProject(projectId)` → `void`; borra `data.projects[projectId]`, conserva las demás entradas y las claves globales.
  - `projectManager.remove(project)` → `void`; con `project = { repoPath, ... }`. Lanza `PROJECT_NOT_INITIALIZED` si falta `repoPath` y `UNMANAGED_REPOSITORY` si `repoPath` cae fuera de `projectsDir`; si pasa, borra la carpeta del clon.

- [ ] **Step 1: Escribir los tests que fallan**

En `test/config-store.test.js`, al final:

```javascript
test('removeProject quita solo esa entrada y conserva las demás', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setProject('erp', { profile: 'a' });
  store.setProject('medical', { profile: 'b' });
  store.removeProject('erp');
  assert.deepEqual(store.getProject('erp'), {});
  assert.equal(store.getProject('medical').profile, 'b');
});

test('removeProject no borra las claves globales', () => {
  const dir = tempDir();
  const store = createConfigStore(dir);
  store.setSetting('github', { token: 'xyz' });
  store.setProject('erp', { profile: 'a' });
  store.removeProject('erp');
  assert.deepEqual(store.getSetting('github'), { token: 'xyz' });
});

test('removeProject es idempotente si el proyecto no existe', () => {
  assert.doesNotThrow(() => createConfigStore(tempDir()).removeProject('nada'));
});
```

En `test/projects.test.js`, al final:

```javascript
test('remove borra el clon dentro de la carpeta administrada', () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'package.json'), '{}');
  createProjectManager({ projectsDir, run: async () => ({ stdout: '', stderr: '' }) })
    .remove({ repoPath, repoUrl: 'x', defaultBranch: 'main' });
  assert.equal(fs.existsSync(repoPath), false);
});

test('remove rechaza una ruta fuera de la carpeta administrada', () => {
  const projectsDir = temp();
  const outside = path.join(projectsDir, '..', 'personal');
  assert.throws(
    () => createProjectManager({ projectsDir, run: async () => ({ stdout: '', stderr: '' }) })
      .remove({ repoPath: outside, repoUrl: 'x', defaultBranch: 'main' }),
    (err) => err.code === 'UNMANAGED_REPOSITORY',
  );
});

test('remove sin repoPath lanza PROJECT_NOT_INITIALIZED', () => {
  const projectsDir = temp();
  assert.throws(
    () => createProjectManager({ projectsDir, run: async () => ({ stdout: '', stderr: '' }) }).remove({}),
    (err) => err.code === 'PROJECT_NOT_INITIALIZED',
  );
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test test/config-store.test.js test/projects.test.js`
Expected: FAIL — `store.removeProject is not a function` y `manager.remove is not a function`.

- [ ] **Step 3: Implementar en `config-store.js`**

En `main/config-store.js`, dentro del objeto `return { ... }`, justo después de `setProject` (después de la línea 50 `},`):

```javascript
    removeProject(projectId) {
      const data = readAll();
      if (data.projects) delete data.projects[projectId];
      writeAll(data);
    },
```

- [ ] **Step 4: Implementar en `projects.js`**

En `main/projects.js`, dentro de `createProjectManager`, añadir la función (p. ej. justo antes de `return { initialize, importExisting, prepare, checkStatus };` en la línea 197):

```javascript
  function remove(project) {
    if (!project?.repoPath) throw appError('PROJECT_NOT_INITIALIZED', 'El proyecto no está inicializado correctamente.');
    validateManagedPath(project.repoPath, projectsDir);
    fs.rmSync(project.repoPath, { recursive: true, force: true });
  }
```

Y ampliar el `return` de la línea 197:

```javascript
  return { initialize, importExisting, prepare, checkStatus, remove };
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `node --test test/config-store.test.js test/projects.test.js`
Expected: PASS — incluidos los 6 casos nuevos.

- [ ] **Step 6: Suite completa + inspección working tree (sin commitear)**

Run: `npm test`
Expected: PASS — 191 + 6 = 197. Revisar diffs de `config-store.js`, `projects.js` y sus tests.

---

### Task 3: IPC + preload (`projects:removalSummary`, `projects:remove`)

**Files:**
- Modify: `main/ipc.js` (sección proyectos, después de `projects:prepare`, ~línea 144)
- Modify: `preload.js` (sección "proyectos", después de la línea 13)

**Interfaces:**
- Consumes: `profileStore.removeProject`, `resultsStore.removeProject`, `recordingsStore.removeProject` (Task 1); `store.removeProject` y `projects.remove` (Task 2); `ensureProject(projectId)` (ya existe, `main/ipc.js:84`); `profileStore.list`, `recordingsStore.list`, `resultsStore.list` (ya existen).
- Produces:
  - IPC `projects:removalSummary(projectId)` → `{ profiles: number, recordings: number, results: number }`.
  - IPC `projects:remove(projectId, opts)` con `opts = { deleteData: boolean }` → `{ ok: true }` o `{ ok: false, error, code }`.
  - preload: `api.projectRemovalSummary(projectId)` y `api.removeProject(projectId, opts)`.

> Nota: `ipc.js` no tiene suite unitaria en el repo (su lógica de borrado vive en los módulos ya probados en Tasks 1-2). Se verifica con `npm test` en verde y `node --check`.

- [ ] **Step 1: Añadir los handlers en `ipc.js`**

En `main/ipc.js`, después del handler `projects:prepare` (que termina en la línea 144 con `});`), añadir:

```javascript
  ipcMain.handle('projects:removalSummary', (_event, projectId) => ({
    profiles: profileStore.list(projectId).length,
    recordings: recordingsStore.list(projectId).length,
    results: resultsStore.list(projectId).length,
  }));
  ipcMain.handle('projects:remove', (_event, projectId, opts) => {
    try {
      const project = ensureProject(projectId);
      projects.remove(project);
      store.removeProject(projectId);
      if (opts?.deleteData) {
        profileStore.removeProject(projectId);
        resultsStore.removeProject(projectId);
        recordingsStore.removeProject(projectId);
      }
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message || String(err), code: err.code }; }
  });
```

- [ ] **Step 2: Exponer en `preload.js`**

En `preload.js`, en la sección `// proyectos`, después de la línea `prepareProject: (projectId) => ipcRenderer.invoke('projects:prepare', projectId),` (línea 13):

```javascript
  projectRemovalSummary: (projectId) => ipcRenderer.invoke('projects:removalSummary', projectId),
  removeProject: (projectId, opts) => ipcRenderer.invoke('projects:remove', projectId, opts),
```

- [ ] **Step 3: Verificar sintaxis y suite**

Run: `node --check main/ipc.js && node --check preload.js && npm test`
Expected: OK en los dos `--check`; PASS 197 en la suite (los handlers no añaden tests unitarios).

- [ ] **Step 4: Inspección working tree (sin commitear).**

Revisar los diffs de `ipc.js` y `preload.js` con snapshots antes/después.

---

### Task 4: Renderer — botón, modal de confirmación y transición

**Files:**
- Modify: `renderer/renderer.js` — tarjeta Repositorio en `renderConfig` (~línea 1422); funciones nuevas `openDeleteProjectModal` y `afterRemoval`; stub offline (~línea 1746)

**Interfaces:**
- Consumes: `api.projectRemovalSummary`, `api.removeProject` (Task 3); `currentProject`, `escapeHtml`, `warnIcon`, `closeModal`, `$overlay`, `state`, `projects`, `loadProject`, `loadProfiles`, `renderProjectSwitcher`, `renderProfileSwitcher`, `renderSidebarStatus`, `renderScreen`, `renderEmptyProject` (todos existen en `renderer.js`).
- Produces: `openDeleteProjectModal(projectId)` (async) y `afterRemoval()` (async).

- [ ] **Step 1: Añadir el botón a la tarjeta Repositorio**

En `renderer/renderer.js`, en `renderConfig`, la tarjeta Repositorio actual (líneas 1422-1426) es:

```javascript
        <div class="card" style="margin-top:14px">
          <div class="config-label">Repositorio</div>
          <button class="btn btn-secondary btn-sm" id="config-open-folder" style="margin-top:10px" ${cfg.hasRepo ? '' : 'disabled'}>Abrir carpeta del repo</button>
          <div id="config-repo-status" class="config-hint" style="color:var(--red-dark)">${cfg.hasRepo ? '' : 'La carpeta del repositorio no está disponible.'}</div>
        </div>
```

Reemplazarla por (añade el botón de eliminar debajo del estado):

```javascript
        <div class="card" style="margin-top:14px">
          <div class="config-label">Repositorio</div>
          <button class="btn btn-secondary btn-sm" id="config-open-folder" style="margin-top:10px" ${cfg.hasRepo ? '' : 'disabled'}>Abrir carpeta del repo</button>
          <div id="config-repo-status" class="config-hint" style="color:var(--red-dark)">${cfg.hasRepo ? '' : 'La carpeta del repositorio no está disponible.'}</div>
          <button class="btn btn-danger btn-sm" id="config-remove-repo" style="margin-top:14px">Eliminar repositorio</button>
        </div>
```

- [ ] **Step 2: Cablear el botón dentro de `renderConfig`**

En `renderer/renderer.js`, al final de `renderConfig` (justo antes del `}` de cierre en la línea 1468, después del bloque `if (cfg.hasRepo) { ... }`), añadir:

```javascript
  document.getElementById('config-remove-repo').onclick = () => openDeleteProjectModal(state.project);
```

- [ ] **Step 3: Añadir `openDeleteProjectModal`**

En `renderer/renderer.js`, después de `renderConfig` (después de la línea 1468) y antes del bloque de GRABACIONES, añadir:

```javascript
async function openDeleteProjectModal(projectId) {
  const name = currentProject()?.name || '';
  const s = await api.projectRemovalSummary(projectId);
  const total = s.profiles + s.recordings + s.results;
  const parts = [];
  if (s.profiles) parts.push(`${s.profiles} ${s.profiles === 1 ? 'perfil' : 'perfiles'}`);
  if (s.recordings) parts.push(`${s.recordings} ${s.recordings === 1 ? 'grabación' : 'grabaciones'}`);
  if (s.results) parts.push(`${s.results} ${s.results === 1 ? 'resultado guardado' : 'resultados guardados'}`);

  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:480px"><div class="modal-pad">
    <div style="display:flex;gap:12px;align-items:flex-start;">${warnIcon()}
      <div style="flex:1;min-width:0;">
        <div class="modal-title">Eliminar repositorio</div>
        <div class="modal-sub" style="margin-top:6px;">Vas a eliminar el repositorio ${name ? `«${escapeHtml(name)}»` : ''}. Esta acción no se puede deshacer.</div>
        ${total > 0 ? `
          <div class="modal-sub" style="margin-top:12px;">Este repositorio tiene ${escapeHtml(parts.join(', '))}.</div>
          <label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="del-repo-data" style="margin-top:2px;flex:none;">
            <span>Eliminar también estos datos. Si lo dejas sin marcar, se conservan.</span>
          </label>
        ` : ''}
        <div id="del-repo-error" style="display:none;margin-top:12px;color:#b91c1c;font-size:12px"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="del-repo-cancel">Cancelar</button>
      <button class="btn btn-danger" id="del-repo-confirm">Eliminar repositorio</button>
    </div>
  </div></div>`;

  document.getElementById('del-repo-cancel').onclick = () => closeModal();
  document.getElementById('del-repo-confirm').onclick = async () => {
    const deleteData = total > 0 && document.getElementById('del-repo-data').checked;
    const res = await api.removeProject(projectId, { deleteData });
    if (!res.ok) {
      const err = document.getElementById('del-repo-error');
      err.textContent = res.error || 'No se pudo eliminar el repositorio.';
      err.style.display = 'block';
      return;
    }
    closeModal();
    await afterRemoval();
  };
}
```

- [ ] **Step 4: Añadir `afterRemoval`**

En `renderer/renderer.js`, justo después de `openDeleteProjectModal`, añadir:

```javascript
async function afterRemoval() {
  projects = await api.listProjects();
  state.project = projects[0]?.id || null;
  state.screen = 'dashboard';
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === 'dashboard'));
  renderProjectSwitcher();
  if (!state.project) {
    state.profiles = [];
    state.profile = null;
    renderProfileSwitcher();
    renderSidebarStatus();
    renderEmptyProject();
    return;
  }
  state.loadingProject = state.project;
  renderProjectSwitcher();
  try {
    if (!await loadProject(state.project)) return;
    await loadProfiles();
    renderSidebarStatus();
    renderScreen();
  } finally {
    state.loadingProject = null;
    renderProjectSwitcher();
  }
}
```

- [ ] **Step 5: Añadir los stubs offline**

En `renderer/renderer.js`, dentro de `createBrowserStub`, después de `prepareProject` (línea 1746), añadir:

```javascript
    async projectRemovalSummary() { return { profiles: 2, recordings: 1, results: 3 }; },
    async removeProject() { return { ok: true }; },
```

- [ ] **Step 6: Verificar sintaxis y suite**

Run: `node --check renderer/renderer.js && npm test`
Expected: OK en `--check`; PASS 197 (el renderer no tiene tests unitarios).

- [ ] **Step 7: Smoke manual (requiere display; lo hace el usuario con `npm start`)**

Verificar:
1. Configuración → tarjeta Repositorio muestra **Eliminar repositorio** (rojo).
2. En un proyecto **sin** perfiles/grabaciones/resultados: el modal no muestra lista ni checkbox, solo la advertencia.
3. En un proyecto **con** datos: el modal lista los conteos y el checkbox aparece **desmarcado**.
4. Eliminar **sin** marcar el checkbox → el proyecto desaparece de la app; al volver a agregar el mismo repo (mismo id), reaparecen perfiles/resultados/grabaciones.
5. Eliminar **marcando** el checkbox → al reagregar, ya no hay datos asociados.
6. Eliminar el **último** proyecto → estado vacío (`renderEmptyProject`).
7. Tras eliminar quedando otros proyectos → cae en el primero disponible, pantalla Dashboard.

- [ ] **Step 8: Inspección working tree (sin commitear).**

Revisar el diff de `renderer.js` con snapshots antes/después.

---

## Self-Review

Cobertura del spec:

- Botón **Eliminar repositorio** en la tarjeta Repositorio de Configuración → Task 4 (Steps 1-2).
- Borrado siempre de **clon + ficha** → Task 2 (`projects.remove` + `config-store.removeProject`) orquestado en Task 3 (`projects:remove`).
- Datos asociados (perfiles + resultados + grabaciones) como **elección única** → Task 1 (`removeProject` por store) + Task 3 (`opts.deleteData`) + Task 4 (checkbox).
- **Summary/conteos** para la advertencia → Task 3 (`projects:removalSummary`) + Task 4 (render de la lista).
- Modal **obligatorio**: con datos (lista + checkbox desmarcado) vs sin datos (advertencia simple) → Task 4 (Step 3, ramas `total > 0`).
- **Conservar** = archivos intactos en disco (reaparecen al reagregar mismo id) → consecuencia de que Task 3 solo borra los stores si `deleteData`; verificado en smoke (Step 7, casos 4-5).
- **Validación de ruta administrada** (nunca borrar fuera de `projectsDir`) → Task 2 (`validateManagedPath` en `remove`, test dedicado).
- **Transición** tras borrar (siguiente proyecto o estado vacío) → Task 4 (`afterRemoval`).
- **Testing**: unit de `removeProject` en 4 stores + `remove` en projects → Tasks 1-2; IPC/UI por smoke → Tasks 3-4.
- **Casos borde** del spec: clon inexistente (`force:true`, no falla), ruta no administrada (test), `deleteData` a mitad (try/catch en el handler; el proyecto ya se quitó), último proyecto (smoke caso 6) → cubiertos en Tasks 2-4.

Consistencia de tipos/nombres:

- `removeProject(projectId)` idéntico en los 4 stores (Tasks 1-2) y su consumo en Task 3.
- `projectManager.remove(project)` (Task 2) llamado como `projects.remove(project)` en Task 3 (en `ipc.js` el módulo se importa como `projects`).
- IPC `projects:removalSummary` / `projects:remove` y sus wrappers `projectRemovalSummary` / `removeProject` coinciden entre Task 3 y Task 4.
- `projects:remove` recibe `{ deleteData }` en Task 3 y Task 4 lo arma igual (`{ deleteData }`).
- `projectRemovalSummary` devuelve `{ profiles, recordings, results }` (Task 3) y Task 4 lee esas tres claves.
