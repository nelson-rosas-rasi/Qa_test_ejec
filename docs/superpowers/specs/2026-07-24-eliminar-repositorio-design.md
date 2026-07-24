# Eliminar repositorio clonado — Diseño

Fecha: 2026-07-24
Estado: aprobado (working tree, sin commitear)
Proyecto: RunQA (`Qa_test_ejec/electron-app`)

## Contexto

En RunQA un **proyecto es un repositorio clonado**: cada uno vive en
`projectsDir/<id>` (`userData/proyectos/<id>`) y su ficha en `config-store.js`
guarda `repoUrl`, `repoPath`, `defaultBranch`, el perfil activo (`profile`) y la
URL de n8n (`n8nWebhookUrl`). Los proyectos se crean con
`projects:initialize` (clonar desde URL) o `projects:importFolder` (clonar desde
una carpeta local).

Datos asociados a un proyecto, todos guardados **fuera del clon** y bajo su
propia carpeta `<base>/<projectId>/`:

- **Perfiles** — `userData/perfiles/<projectId>/<id>.enc` (cifrados).
  `main/profiles/store.js`: `list(projectId)`, `remove(projectId, id)`.
- **Resultados/reportes** — `<resultsDir>/<projectId>/<runId>.json` + carpeta
  `<runId>/` con el reporte HTML/PDF. `main/results/store.js`: `list(projectId)`,
  `remove(projectId, runId)`.
- **Grabaciones (borradores)** — `<recordingsDir>/<projectId>/<id>.spec.ts` +
  `<id>.json`. `main/recordings/store.js`: `list(projectId)`, `remove(projectId, id)`.

Que estos datos vivan fuera del clon es intencional: sobreviven a reclonados
(ver comentario en `profiles/store.js`).

**Hueco que este spec llena:** no existe ninguna forma de **eliminar un
repositorio** ya agregado. Si se clona el repo equivocado, no hay salida más que
manipular el disco a mano. `config-store` no tiene `removeProject`, no hay handler
`projects:remove`, y la tarjeta "Repositorio" de Configuración solo ofrece "Abrir
carpeta del repo".

## Alcance

Agregar la acción **Eliminar repositorio** en la tarjeta "Repositorio" de la
pantalla **Configuración** (acotada, como el resto de la app, al proyecto
seleccionado).

El borrado **siempre** elimina:

- La **carpeta del clon** (`repoPath`).
- La **ficha del proyecto** en `config-store` (URL de n8n, puntero al perfil
  activo, etc.).

Los **datos asociados** (perfiles + resultados + grabaciones) son una **elección
del usuario**: conservar o eliminar, tratados **como un solo bloque** (opción A:
un único checkbox; ver "Fuera de alcance"). Conservar deja los archivos intactos
en disco; como se guardan por `projectId` fuera del clon, si más adelante se
vuelve a agregar el mismo repo y toma el mismo `id`, esos datos reaparecen.

La confirmación es un **modal obligatorio**, siempre:

- **Con datos asociados:** advierte, lista los conteos ("Este repositorio tiene
  2 perfiles, 3 grabaciones y 5 resultados guardados") y ofrece un checkbox
  **"Eliminar también estos datos"**, desmarcado por defecto (= conservar, el
  camino seguro).
- **Sin datos asociados:** advertencia simple ("Vas a eliminar el repositorio
  *X*. Esta acción no se puede deshacer.").

Tras eliminar: recargar la lista de proyectos y cambiar al primero que quede, o
mostrar el estado vacío (`renderEmptyProject`) si no queda ninguno.

### Fuera de alcance (YAGNI)

- **Grano por tipo** de dato (checkboxes separados para perfiles/grabaciones/
  resultados). Se decidió la opción A: un único checkbox que cubre todo el bloque.
  El caso motivador ("cloné el equivocado") no lo necesita.
- **Papelera / deshacer.** La eliminación es definitiva (el checkbox por defecto en
  "conservar" y el modal obligatorio son la red de seguridad).
- **Type-to-confirm** (escribir el nombre del repo). Se usa el mismo patrón de
  confirmación peligrosa que el borrado de perfiles.
- Tests de UI del renderer (el repo no los tiene; smoke manual).

## Arquitectura y módulos

Se mantiene el patrón actual: **handlers de IPC delgados** y la lógica de borrado
en los módulos, cubierta por tests con directorios temporales.

### Backend (`main/`)

- **`profiles/store.js`, `results/store.js`, `recordings/store.js`** — cada uno
  gana un método nuevo:
  - `removeProject(projectId)` → `fs.rmSync(projectDir(projectId), { recursive: true, force: true })`.
    Borra toda la carpeta del proyecto de ese store de un golpe (no requiere
    enumerar ids). Idempotente (`force: true` no falla si no existe).
- **`projects.js`** (`createProjectManager`) — método nuevo:
  - `remove(project)` → valida `validateManagedPath(project.repoPath, projectsDir)`
    (nunca borra fuera de `projectsDir`) y luego
    `fs.rmSync(project.repoPath, { recursive: true, force: true })`. Si `repoPath`
    es falsy o queda fuera del área administrada, lanza `appError` (defensa; no
    debería pasar con fichas válidas).
- **`config-store.js`** — método nuevo:
  - `removeProject(projectId)` → lee todo, `delete data.projects[projectId]`,
    reescribe. Idempotente.
- **`ipc.js`** — dos handlers nuevos:
  - `projects:removalSummary(projectId)` → `{ profiles, recordings, results }` con
    los tres conteos vía `profileStore.list`, `recordingsStore.list`,
    `resultsStore.list` (longitudes). Alimenta el modal.
  - `projects:remove(projectId, opts)` con `opts = { deleteData: boolean }`:
    1. `const project = ensureProject(projectId)`.
    2. `projects.remove(project)` (borra el clon).
    3. `store.removeProject(projectId)` (borra la ficha).
    4. Si `opts.deleteData`: `profileStore.removeProject(projectId)`,
       `resultsStore.removeProject(projectId)`,
       `recordingsStore.removeProject(projectId)`.
    5. `{ ok: true }`. Errores → `{ ok:false, error, code }` (patrón actual).
    El orden borra primero el clon y la ficha; si `deleteData` falla, el proyecto
    ya desapareció de la app y solo quedan datos huérfanos (aceptable, no bloquea).

### `preload.js`

Expone en `window.qa`:

- `projectRemovalSummary: (projectId) => invoke('projects:removalSummary', projectId)`
- `removeProject: (projectId, opts) => invoke('projects:remove', projectId, opts)`

### Frontend (`renderer/`)

- **`renderer.js`**:
  - `renderConfig()` — en la tarjeta "Repositorio", debajo de "Abrir carpeta del
    repo", un botón `Eliminar repositorio` con estilo peligro. `onclick` →
    `openDeleteProjectModal(state.project)`.
  - `openDeleteProjectModal(projectId)` *(función nueva)*:
    1. `const s = await api.projectRemovalSummary(projectId)`.
    2. `const total = s.profiles + s.recordings + s.results`.
    3. Arma el mensaje: nombre del repo + "Esta acción no se puede deshacer.". Si
       `total > 0`, añade la lista de conteos y un checkbox
       "Eliminar también estos datos" (desmarcado).
    4. Usa `openConfirm({ danger: true, confirmText: 'Eliminar repositorio',
       onConfirm })`, o un modal a medida si se necesita el checkbox (ver Nota).
    5. `onConfirm`: `deleteData = total > 0 && checkbox.checked`;
       `await api.removeProject(projectId, { deleteData })`; luego `afterRemoval()`.
  - `afterRemoval()` — recarga proyectos (misma ruta que ya usa la app para poblar
    `state.projects`), selecciona el primero restante o, si no queda ninguno,
    `renderEmptyProject()`; refresca el switcher de proyectos y el sidebar.

**Nota (modal con checkbox):** `openConfirm` actual (`renderer.js:904`) toma
`title/message/confirmText/cancelText/danger/onConfirm`. Para el checkbox, la vía
más limpia es que el `message` pueda incluir HTML (un `<label><input
type="checkbox">…</label>`) y que `openDeleteProjectModal` lea ese checkbox del
DOM del overlay en `onConfirm`; si `openConfirm` no admite HTML, se implementa
`openDeleteProjectModal` con su propio markup siguiendo el patrón de
`openDeleteProfileModal` (`renderer.js:780`). La decisión concreta se toma en el
plan al mirar `openConfirm`.

## Pantalla Configuración — tarjeta Repositorio (después)

```
│  Repositorio                                   │
│   [ Abrir carpeta del repo ]                   │
│   [ Eliminar repositorio ]   (rojo, peligro)   │
```

## Modal de confirmación

Con datos asociados:

```
┌─ Eliminar repositorio ────────────────────────┐
│ Vas a eliminar el repositorio "RunQA".        │
│ Esta acción no se puede deshacer.             │
│                                                │
│ Este repositorio tiene:                        │
│   • 2 perfiles                                 │
│   • 3 grabaciones                              │
│   • 5 resultados guardados                     │
│                                                │
│ [ ] Eliminar también estos datos              │
│     (si lo dejas sin marcar, se conservan)     │
│                                                │
│         [ Cancelar ]  [ Eliminar repositorio ] │
└────────────────────────────────────────────────┘
```

Sin datos asociados: mismo modal sin la lista ni el checkbox.

## Flujos

- **Eliminar sin datos:** Config → Eliminar repositorio → modal simple →
  Confirmar → `projects:remove(id, { deleteData:false })` → se borra clon + ficha
  → `afterRemoval`.
- **Eliminar conservando datos:** modal con conteos, checkbox **desmarcado** →
  Confirmar → `deleteData:false` → clon + ficha borrados; perfiles/resultados/
  grabaciones quedan en disco → reaparecen si se reagrega el mismo repo (mismo id).
- **Eliminar todo:** checkbox **marcado** → `deleteData:true` → además se borran
  las carpetas de los tres stores para ese `projectId`.

## Errores y casos borde

- **Ruta fuera del área administrada / `repoPath` faltante:** `projects.remove`
  valida con `validateManagedPath` y lanza antes de borrar nada peligroso.
- **Clon ya inexistente en disco:** `fs.rmSync(..., { force:true })` no falla; la
  ficha se borra igual (permite limpiar proyectos rotos).
- **`deleteData` falla a mitad:** el proyecto ya se quitó de la app (clon + ficha);
  quedan datos huérfanos que no se muestran. No se revierte (no bloquea al usuario).
- **Eliminar el último proyecto:** `afterRemoval` cae en `renderEmptyProject()`.
- **Eliminar el proyecto actualmente abierto (caso normal):** `afterRemoval`
  cambia el `state.project` al siguiente disponible antes de re-renderizar.

## Testing

- **Unit (`node:test`, temp dirs, estilo actual):**
  - `test/results-store.test.js`, `test/recordings-store.test.js`,
    `test/profile-store.test.js`: añadir un caso por store para
    `removeProject(projectId)` — borra la carpeta de ESE proyecto y **no toca** la
    de otro `projectId`; idempotente si la carpeta no existe.
  - `test/config-store.test.js`: `removeProject` quita solo esa entrada y conserva
    las demás.
  - `test/projects.test.js`: `remove(project)` borra `repoPath` dentro de
    `projectsDir` y **rechaza** una ruta fuera del área administrada.
- **Smoke manual (`npm start`, sin display en el entorno del agente):** eliminar un
  repo sin datos; eliminar conservando datos y verificar que reaparecen al
  reagregar; eliminar marcando el checkbox y verificar que las carpetas se van;
  eliminar el último proyecto → estado vacío.

## Notas de integración

- `ipc.js`, `preload.js` y `renderer.js` ya tienen WIP sin commitear de specs
  anteriores (Resultados, Configuración, Reporte PDF, Grabaciones). Trabajar sobre
  el working tree actual; revisar con snapshots (copiar antes/después + `diff -u`)
  en vez de `git diff`.
- Los tres stores (`profiles`, `results`, `recordings`) ya se instancian en
  `registerIpc`, así que `projects:removalSummary`/`projects:remove` tienen acceso
  directo a ellos sin cambios de cableado.
