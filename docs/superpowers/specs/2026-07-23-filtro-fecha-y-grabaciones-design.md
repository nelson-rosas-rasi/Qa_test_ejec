# Filtro por fecha + Módulo de Grabaciones — Diseño

Fecha: 2026-07-23
Estado: en revisión (working tree, sin commitear)
Proyecto: RunQA (`Qa_test_ejec/electron-app`)

Dos features independientes pedidas juntas. Parte A es pequeña (UI de Resultados);
Parte B es grande (grabar pruebas con Playwright codegen y subirlas a git).

---

## Parte A — Filtro por fecha en Resultados

### Contexto
La pantalla Resultados → Registro (`renderResultsRegistry` / `paintResultsTable` /
`filteredResults` en `renderer.js`) filtra las corridas guardadas por resultado
(Todas / Todas pasaron / Con fallos), por modo (Individual / Conjunto) y por texto.

### Alcance
Añadir un **filtro por fecha** (calendario) que muestre solo las corridas de ese día.

- Un `<input type="date">` (calendario nativo del sistema) en la fila de filtros del
  Registro, con una **×** para limpiar.
- Al elegir una fecha, `filteredResults` incluye solo las corridas cuyo `finishedAt`
  cae en ese día (comparación por fecha **local**).
- Se combina con los filtros existentes (resultado/modo/texto).

### Implementación
- `renderer.js`: `state.resultsFilter.date` (string `YYYY-MM-DD` o `''`). En
  `renderResultsRegistry` se pinta el input; en `filteredResults` se aplica el predicado
  `matchesDate(record, date)`.
- **Pure/testeable:** extraer `matchesDate(finishedAt, dateStr)` a un módulo del main
  reutilizable en test (o dejarlo en renderer y probar la lógica en un helper del main).
  Para poder testear, se pone `matchesDate` en `main/results/metrics.js` o un helper
  nuevo `main/results/filter.js` y el renderer lo replica de forma trivial. **Decisión:**
  helper puro `main/results/filter.js` con `matchesLocalDate(isoString, 'YYYY-MM-DD')`,
  con test; el renderer usa la misma lógica inline (es una comparación de fecha corta).

### Fuera de alcance
- Rangos de fechas (solo un día). Se puede ampliar luego.

---

## Parte B — Módulo "Grabaciones"

### Contexto y restricción clave
El clon administrado del proyecto (`project.repoPath`) se maneja en **HEAD desasociado**
y en cada "Actualizar pruebas" (`projects.prepare`) se hace `reset --hard` + `clean -fd`
([projects.js:163-165]) → **borra cualquier cambio del working tree**. Por lo tanto las
grabaciones **no pueden vivir sueltas en el clon**: se guardan aparte (datos de RunQA) y
la subida a git se hace en un **checkout aislado**, sin tocar el clon de ejecución.

Auth de git ya existe: `createGitAuth` (`main/github/git-auth.js`) inyecta el token de la
cuenta conectada por entorno; `createProjectManager` corre `git` con ese auth.

### Alcance
Una nueva pantalla **"Grabaciones"** (por proyecto) que permite:
1. **Grabar** un flujo con Playwright **codegen** → genera un `.spec.ts` (draft).
2. **Gestionar drafts**: **renombrar** y **eliminar**. **No se edita** el contenido en la
   app (inmutable; para cambiarlo se graba de nuevo).
3. **Subir** un draft: elegir una **rama** (de las existentes o una **nueva**) y hacer
   **commit + push** del archivo a esa rama, en un checkout aislado. Requiere cuenta de
   GitHub conectada.

### Decisiones acordadas
- **Grabar = Playwright codegen.** Se lanza `codegen` con el CLI de Playwright del clon
  (para tener navegadores instalados), `cwd` = `repoPath`, y `--output` a un archivo de
  draft **fuera del clon**. Requiere pantalla/navegador (lo prueba el usuario).
- **URL de inicio**: campo editable, **precargado autodetectando** una URL del `.env` del
  perfil activo (primera clave cuyo valor sea `http(s)://…`); si no hay, el QA la escribe.
- **Subida**: se listan las ramas remotas; el QA elige una existente **o escribe una
  nueva**; el archivo va a `tests/<nombre>.spec.ts`; commit + push a esa rama.
- **Drafts** se guardan en `userData/grabaciones/<projectId>/` (sobreviven a las
  actualizaciones del clon).
- Inmutables salvo **renombrar** y **eliminar**.

### Fuera de alcance (YAGNI)
- Editor de código en la app (los drafts no se editan; se re-graban).
- Merge/PR automático: solo se hace push a la rama elegida; el equipo revisa/mezcla aparte.
- Gestión de conflictos avanzada: si el push es rechazado (rama protegida, no fast-forward),
  se muestra el error de git tal cual.

### Arquitectura y módulos

**Backend (`main/recordings/`)**
- `store.js` *(nuevo)* — drafts en `userData/grabaciones/<projectId>/`:
  `list(projectId)`, `path(projectId, id)`, `saveGenerated(projectId, tmpFile, name)`,
  `rename(projectId, id, name)`, `remove(projectId, id)`. Cada draft son dos archivos:
  `<id>.spec.ts` (el código generado) y `<id>.json` (metadata: nombre visible, fecha,
  y si ya se subió, a qué rama y cuándo). `remove` borra ambos.
- `detect.js` *(nuevo, puro y testeable)* — `detectBaseUrl(profileValues)` (primera clave
  con valor `http(s)://…`), `draftFileName(name)` (slug → `<slug>.spec.ts`),
  `sanitizeBranch(name)` (valida/normaliza el nombre de rama).
- `codegen.js` *(nuevo, thin)* — `record({ cliPath, repoPath, url, outFile, nodePath })`:
  spawnea `node <cliPath> codegen --target playwright-test --output <outFile> <url>` con
  `cwd: repoPath`; resuelve cuando el proceso cierra. Devuelve `{ ok, outFile }`.
- `upload.js` *(nuevo, thin sobre git)* — usa un **clon de subida aislado** por proyecto en
  `userData/grabaciones-git/<projectId>/` (clonado una vez, luego `fetch`):
  - `listBranches(project)` → ramas remotas (`git ls-remote --heads` con auth).
  - `upload({ project, draftPath, repoRelPath, branch, isNew, message, identity })` →
    en el clon de subida: `fetch`; `checkout` de la rama (o `checkout -b` desde el
    `defaultBranch` si es nueva); copia el archivo a `repoRelPath`; `add`; `commit`
    (author/committer = identidad de la cuenta); `push origin <branch>`. Nunca toca el
    clon de ejecución.
- **`main/ipc.js`** — handlers: `recordings:list`, `recordings:record` (autodetecta URL,
  lanza codegen, guarda el draft), `recordings:rename`, `recordings:remove`,
  `recordings:branches`, `recordings:upload`.
- **`preload.js`** — wrappers `listRecordings`, `recordFlow`, `renameRecording`,
  `removeRecording`, `listBranches`, `uploadRecording`.

**Frontend (`renderer/`)**
- `index.html` — 6º `nav-item` `data-screen="recordings"` (ícono de grabar/rec).
- `renderer.js` — `renderRecordings()`: campo de URL (precargado) + botón **Grabar**;
  lista de drafts (nombre, fecha, estado) con **Renombrar** / **Eliminar** / **Subir**;
  modal de **Subir** que lista ramas + opción "rama nueva".

### Flujos
- **Grabar**: `recordings:record` autodetecta la URL (editable), lanza codegen; al cerrarse
  el grabador, mueve el `.spec.ts` generado a un draft nuevo (nombre por defecto con fecha,
  renombrable). Si no hay cuenta/entorno para codegen, error claro.
- **Renombrar / Eliminar**: sobre el draft local (no toca git).
- **Subir**: modal → `recordings:branches` lista ramas → el QA elige existente o escribe una
  nueva → `recordings:upload` hace commit+push en el clon aislado → marca el draft como
  subido (rama + fecha). Errores de git (rama protegida, sin acceso, no fast-forward) se
  muestran con el mensaje real.

### Errores y casos borde
- Sin cuenta de GitHub conectada → Subir deshabilitado con aviso (reutiliza `needsGithub`).
- codegen sin display/navegadores → error claro; el draft no se crea.
- Nombre de rama inválido → se normaliza/valida (`sanitizeBranch`) antes de push.
- Push rechazado → se muestra el error; el draft queda local para reintentar.
- El clon de subida se valida como ruta administrada (patrón `validateManagedPath`).

### Testing
- **Unit (`node:test`):** `main/recordings/detect.js` (`detectBaseUrl`, `draftFileName`,
  `sanitizeBranch`) y `main/results/filter.js` (`matchesLocalDate`). Los módulos `codegen`,
  `upload` y los handlers IPC son delgados y se verifican con **smoke manual** (`npm start`,
  requiere display + red + un repo real; el entorno del agente no los tiene).
- **Smoke manual:** grabar un flujo → aparece el draft → renombrar → subir a una rama nueva
  → verificar el push en el remoto; filtro por fecha en Resultados.

### Notas de integración
- No commitear el trabajo de RunQA (working tree). La subida a git del **repo de pruebas**
  del QA sí es funcionalidad de la app (commit+push al repo clonado, no al de RunQA).
- Pendientes previos (fuera de este spec): colocar `rasi-logo.png`, smoke del reporte PDF
  y del botón Detener.
