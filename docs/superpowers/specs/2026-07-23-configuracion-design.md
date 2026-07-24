# Configuración — Diseño (Spec B)

Fecha: 2026-07-23
Estado: aprobado (working tree, sin commitear)
Proyecto: RunQA (`Qa_test_ejec/electron-app`)

## Contexto

RunQA es una app Electron que corre pruebas Playwright para QA. El Spec A
(Resultados y reportes) ya está implementado en el working tree. Este spec cubre
el Spec B: una pantalla de **Configuración** para gestionar los perfiles de QA y
un par de ajustes del proyecto.

Lo que ya existe y este spec reutiliza:

- **Perfiles** cifrados en `userData/perfiles/<proyecto>/<id>.enc`. El `id` es un
  slug derivado del nombre en el momento de crear y se usa como nombre del archivo
  materializado `.env.<id>`. `QA_NOMBRE`/`QA_CARGO` son los campos que se muestran.
  `main/profiles/store.js` ya expone `save/load/list/remove`.
- **URL de n8n**: `resolveN8nUrl` en `main/ipc.js` usa primero el ajuste de
  proyecto `n8nWebhookUrl` (en `config-store`) y, si está vacío, el campo
  `N8N_WEBHOOK_URL` del perfil activo.
- **`config-store.js`** con `getProject/setProject` (merge) y `getSetting/setSetting`.
- **Navegación** actual: Pruebas / Ejecución en vivo / Resultados. El perfil activo
  del proyecto vive en `config-store` bajo `project.profile` (el `id`).

Huecos que este spec llena:

- No hay forma de **editar** los campos de un perfil existente (el modal actual
  solo crea).
- `profileStore.remove` no está expuesto por IPC; no hay **eliminar** perfil.
- No hay UI para **ver/editar** la URL de n8n del proyecto.
- No hay acción para **abrir la carpeta del repo** clonado.

## Alcance

Una **nueva pantalla "Configuración"** (4º ítem de navegación), acotada al
proyecto seleccionado (consistente con el resto de la app), con dos secciones:

1. **Perfiles**
   - Lista los perfiles del proyecto, marcando el activo.
   - **Editar**: abre el formulario completo precargado con los valores guardados
     del perfil; renombrar = cambiar el campo del nombre (`QA_NOMBRE`) ahí mismo.
   - **Eliminar**: con confirmación; **bloqueado para el perfil activo** (hay que
     activar otro primero). Como consecuencia, el único perfil de un proyecto no se
     puede eliminar mientras sea el activo.
   - **Añadir perfil**: reutiliza el flujo de creación existente.
2. **Proyecto**
   - **URL de n8n** (`n8nWebhookUrl`): campo editable a nivel de proyecto. Si se
     deja vacío, se usa el `N8N_WEBHOOK_URL` del perfil activo, que se muestra como
     pista de respaldo.
   - **Abrir carpeta del repo**: abre el clon administrado en el explorador de
     archivos del sistema.

### Fuera de alcance (YAGNI)

- Cambiar el `id`/identificador interno del perfil (el usuario nunca lo ve).
- Validación estricta de la URL de n8n (paridad con el resto de campos: solo `trim`).
- Configuración a nivel global / multi-proyecto en la misma pantalla (la pantalla
  refleja el proyecto seleccionado, como el resto de la app).
- Tests de UI del renderer (el repo no los tiene; se verifica con smoke manual).

## Arquitectura y módulos

Se mantiene el patrón actual: **handlers de IPC delgados** y la lógica testeable
en módulos pequeños.

### Backend (`main/`)

- **`profiles/store.js`** — sin cambios de API; se usa `remove(projectId, id)` que
  ya existe.
- **`profiles/decide.js`** *(módulo nuevo, puro y testeable)* — reglas de negocio:
  - `canRemoveProfile(activeId, id)` → `false` si `id === activeId`, `true` si no.
  - `nextActiveAfterSave({ isNew, currentActive, savedId })` → devuelve qué perfil
    queda activo tras guardar: al **crear** (`isNew`) activa `savedId`; al **editar**
    conserva `currentActive`.
- **`config-store.js`** — sin cambios (ya tiene lo necesario).
- **`ipc.js`** — handlers nuevos/ajustados:
  - `profiles:get(projectId, id)` → `profileStore.load(projectId, id)`; devuelve los
    valores guardados (o `{ ok:false, code:'PROFILE_NOT_FOUND' }` si es `null`).
  - `profiles:remove(projectId, id)` → si `!canRemoveProfile(active, id)` devuelve
    `{ ok:false, code:'PROFILE_ACTIVE', error:'…' }`; si no, `profileStore.remove` y
    `{ ok:true }`.
  - `profiles:save` **ajustado** para distinguir crear vs editar:
    - `isNew = !id` (id ausente = crear, como hoy).
    - Guarda con `profileStore.save`.
    - El activo resultante sale de `nextActiveAfterSave`: crear activa el nuevo
      (comportamiento actual); editar **conserva** el activo.
    - Solo re-materializa (`materializeActive`) si el perfil afectado es el activo.
  - `config:get(projectId)` → `{ n8nWebhookUrl, n8nProfileFallback, hasRepo }` donde
    `n8nWebhookUrl` es el ajuste de proyecto (o `''`), `n8nProfileFallback` es el
    `N8N_WEBHOOK_URL` del perfil activo (o `null`) y `hasRepo` es
    `!!repoPath && fs.existsSync(repoPath)`. **No** devuelve `repoPath`.
  - `config:setN8n(projectId, url)` → `store.setProject(projectId, { n8nWebhookUrl: String(url||'').trim() })`.
    Vacío queda como `''` (falsy → aplica el respaldo del perfil en `resolveN8nUrl`).
  - `projects:openFolder(projectId)` → resuelve `repoPath`; si no existe,
    `{ ok:false, error:'…' }`; si existe, `shell.openPath(repoPath)` (mismo patrón que
    `results:openFolder`).

### `preload.js`

Expone en `window.qa`:

- `getProfile: (projectId, id) => invoke('profiles:get', projectId, id)`
- `removeProfile: (projectId, id) => invoke('profiles:remove', projectId, id)`
- `getProjectConfig: (projectId) => invoke('config:get', projectId)`
- `setN8nUrl: (projectId, url) => invoke('config:setN8n', projectId, url)`
- `openProjectFolder: (projectId) => invoke('projects:openFolder', projectId)`

### Frontend (`renderer/`)

- **`index.html`** — 4º `nav-item` con `data-screen="config"` (ícono de engranaje),
  después de "Resultados".
- **`renderer.js`**:
  - Router: `renderScreen()` enruta `config` → `renderConfig()`.
  - `renderConfig()` — pinta la pantalla (ver layout). Usa `api.listProfiles`,
    `api.getActiveProfile`/`state.profile` y `api.getProjectConfig`.
  - Generalizar `openProfileModal(profileId = null)`:
    - Sin `profileId`: crea (título "Crea tu perfil…", valores por defecto del
      schema).
    - Con `profileId`: edita (título "Editar perfil", precarga con
      `api.getProfile`; guarda con `api.saveProfile(projectId, profileId, values)`).
    - Tras guardar/crear: `loadProfiles()`, refrescar switcher y, si la pantalla
      activa es `config`, `renderConfig()`.
  - `openDeleteProfileModal(profileId)` — confirmación; al confirmar
    `api.removeProfile`, refresca.
  - Handlers de la sección Proyecto: guardar n8n (`api.setN8nUrl`), abrir carpeta
    (`api.openProjectFolder`).

## Pantalla Configuración (layout)

```
Configuración
┌───────────────────────────────────────────────┐
│ Perfiles                                       │
│  ┌───────────────────────────────────────────┐ │
│  │ Ana Torres · QA          ● activo         │ │
│  │                      [Editar]  [Eliminar⌀] │ │  ⌀ = deshabilitado (activo)
│  ├───────────────────────────────────────────┤ │
│  │ Luis Peña · QA                            │ │
│  │                      [Editar]  [Eliminar] │ │
│  └───────────────────────────────────────────┘ │
│  [ + Añadir perfil ]                           │
├───────────────────────────────────────────────┤
│ Proyecto                                       │
│  Documentación (n8n)                           │
│   URL del webhook                              │
│   [ https://n8n.../webhook            ] [Guardar]│
│   Si lo dejas vacío se usa la del perfil activo:│
│     https://perfil.../hook                     │
│                                                │
│  Repositorio                                   │
│   [ Abrir carpeta del repo ]                   │
└───────────────────────────────────────────────┘
```

Reutiliza estilos existentes (`screen`, `screen-header`, tarjetas, `btn`,
`btn-secondary`, `btn-primary`). El marcador de "activo" usa el mismo estilo del
switcher de perfil.

## Flujos

- **Editar perfil**: click en Editar → modal con campos precargados desde
  `profiles:get` → Guardar → `profiles:save(projectId, id, values)` (no cambia el
  activo; re-materializa solo si el editado es el activo) → cierra, refresca lista y
  switcher.
- **Eliminar perfil**: botón deshabilitado con tooltip "Activa otro perfil primero
  para poder eliminarlo" si es el activo. En los demás: modal de confirmación →
  `profiles:remove` → refresca.
- **URL de n8n**: al entrar, `config:get` rellena el campo y la pista de respaldo.
  Guardar → `config:setN8n`; vacío limpia el ajuste de proyecto (aplica el respaldo).
- **Abrir carpeta del repo**: `projects:openFolder` abre el clon en el explorador.

## Errores y casos borde

- Eliminar el activo: bloqueado en la UI **y** validado en backend
  (`code:'PROFILE_ACTIVE'`) como defensa.
- Editar un perfil inexistente / valores `null`: `profiles:get` devuelve
  `PROFILE_NOT_FOUND`; la UI muestra "No se pudo cargar el perfil".
- Abrir carpeta sin `repoPath` o carpeta faltante: error claro (patrón de
  `results:openFolder`).
- n8n: solo texto con `trim`; sin validación estricta de URL (paridad).
- Perfil guardado sin `QA_NOMBRE`: se mantiene la lógica actual (el `id` sirve de
  nombre en la lista). Opcional: exigir nombre no vacío en el form.

## Testing

- **Unit (`node:test`, estilo actual: temp dirs + fakes inyectados):**
  - `test/profiles-decide.test.js` (nuevo): `canRemoveProfile` (activo vs no activo)
    y `nextActiveAfterSave` (crear activa el nuevo / editar conserva el activo).
  - `test/profile-store.test.js`: cubrir `remove` (borra el archivo correcto, no toca
    los demás) si aún no está cubierto.
- **Smoke manual (`npm start`, el entorno del agente no tiene display):** pantalla
  Configuración, editar/eliminar/añadir perfil, guardar URL de n8n y abrir carpeta.

## Notas de integración

- `ipc.js`, `preload.js` y `renderer.js` mezclan WIP previo del usuario con cambios
  del Spec A (se editaron encima). No commitear; trabajar en el working tree y revisar
  con snapshots (copiar antes/después + `diff -u`) en vez de `git diff`.
