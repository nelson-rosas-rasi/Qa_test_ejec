# Distribución de RunQA (lo urgente) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar RunQA publicable de forma segura: sin la promesa sin manejar del updater ante un 404, sin riesgo de publicar con el owner/repo ficticio de GitHub, y con la descarga inicial + los pasos de release documentados.

**Architecture:** Tres cambios independientes y mecánicos sobre `electron-app/`: un fix defensivo en `main/updater.js`, un script de guarda (`scripts/check-release-config.js`) que se antepone al script `release` de npm, y una sección nueva en `README.md`. Ningún cambio toca `renderer/`, IPC, ni el build de `electron-builder` en sí (sigue generando `.exe`/`.blockmap`/`latest.yml` igual que hoy).

**Tech Stack:** Node.js (script CLI plano, sin dependencias nuevas), `electron-updater` (ya en `dependencies`), Markdown.

## Global Constraints

- El spec es [2026-07-27-distribucion-urgente-design.md](../specs/2026-07-27-distribucion-urgente-design.md).
- **No introducir un segundo lugar donde viva el owner/repo de GitHub.** La única fuente de verdad sigue siendo `package.json` → `build.publish`.
- Placeholders exactos a detectar: `owner === "CAMBIAME-usuario-u-org"`, `repo === "runqa-releases"` (valores literales actuales en `package.json`).
- `npm run dist` (build local sin publicar) **no cambia**.
- No se agrega ningún framework de test nuevo; el repo usa `node --test` (`node:test`) vía `npm test` → `node --test "test/*.test.js"`.
- No tocar `renderer/`, `main/ipc.js`, ni ninguna pantalla de la UI.
- Todo el copy en español neutro, igual que el resto del repo.
- Al final de cada tarea, `npm test` debe seguir en **224/224** verde (nadie de estas tareas agrega tests nuevos al runner de `node:test`; es la regresión de referencia).
- Working directory de todos los comandos: `electron-app/` (así corren ya los scripts de `package.json`).

---

### Task 1: Corregir la promesa sin manejar en `main/updater.js`

**Files:**
- Modify: `electron-app/main/updater.js:72-73`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: nada que otra tarea consuma (cambio autocontenido).

- [ ] **Step 1: Editar las dos llamadas a `checkForUpdates()`**

Reemplazar en `electron-app/main/updater.js`:

```js
  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
}
```

por:

```js
  const checkForUpdates = () =>
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] no se pudo revisar actualizaciones:', err?.message || err);
    });

  checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}
```

(Esas dos líneas son las últimas dentro de `setupAutoUpdate`, justo antes del `}` que la cierra — el resto del archivo, incluyendo el listener `autoUpdater.on('error', ...)` de arriba, no cambia.)

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check main/updater.js` (desde `electron-app/`)
Expected: sin salida, exit code 0.

- [ ] **Step 3: Correr la suite completa**

Run: `npm test`
Expected: `224/224` pasan (este archivo no tiene tests propios hoy; esto es la regresión de referencia).

- [ ] **Step 4: Commit**

```bash
git add main/updater.js
git commit -m "fix(updater): capturar el rechazo de checkForUpdates ante errores de red/404"
```

---

### Task 2: Guarda contra publicar con el placeholder de GitHub puesto

**Files:**
- Create: `electron-app/scripts/check-release-config.js`
- Modify: `electron-app/package.json` (script `release`)

**Interfaces:**
- Consumes: nada de la Task 1.
- Produces: `findPlaceholderFields(publish)` — función pura exportada por
  `scripts/check-release-config.js`, usada únicamente por este script (ninguna
  otra tarea la consume, pero debe llamarse exactamente así si algo la
  referencia en el futuro).

- [ ] **Step 1: Escribir el script**

Crear `electron-app/scripts/check-release-config.js`:

```js
#!/usr/bin/env node
'use strict';

const path = require('path');

const PLACEHOLDER_OWNER = 'CAMBIAME-usuario-u-org';
const PLACEHOLDER_REPO = 'runqa-releases';

function findPlaceholderFields(publish) {
  const problems = [];
  if (!publish || publish.owner === PLACEHOLDER_OWNER) problems.push('owner');
  if (!publish || publish.repo === PLACEHOLDER_REPO) problems.push('repo');
  return problems;
}

function main() {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const publish = pkg.build && pkg.build.publish;
  const problems = findPlaceholderFields(publish);

  if (problems.length > 0) {
    console.error(
      `[release] falta configurar ${problems.join(' y ')} en package.json -> build.publish ` +
      'antes de publicar (hoy tiene el valor de ejemplo, no un repo real de GitHub).'
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findPlaceholderFields, PLACEHOLDER_OWNER, PLACEHOLDER_REPO };
```

El `if (require.main === module)` es lo que permite probar
`findPlaceholderFields` sin que `main()` (que llama `process.exit`) se dispare
solo por requerir el archivo — así se puede testear manualmente sin tocar el
`package.json` real.

- [ ] **Step 2: Probar manualmente el caso "falla" (placeholder puesto)**

Run (desde `electron-app/`): `node scripts/check-release-config.js; echo "exit: $?"`
Expected: imprime el mensaje `[release] falta configurar owner y repo en package.json...` y `exit: 1` (porque `package.json` todavía tiene el placeholder puesto).

- [ ] **Step 3: Probar manualmente el caso "pasa" (valores reales) sin tocar el package.json real**

Run: `node -e "const {findPlaceholderFields} = require('./scripts/check-release-config.js'); console.log(findPlaceholderFields({owner:'mi-org', repo:'runqa-releases-real'}));"`
Expected: imprime `[]` (array vacío — ningún problema con valores que no son el placeholder).

- [ ] **Step 4: Enganchar la guarda al script `release`**

En `electron-app/package.json`, dentro de `"scripts"`, cambiar:

```json
"release": "electron-builder --publish always"
```

por:

```json
"release": "node scripts/check-release-config.js && electron-builder --publish always"
```

(`"dist": "electron-builder"` no se toca.)

- [ ] **Step 5: Correr la suite completa**

Run: `npm test`
Expected: `224/224` pasan (el script vive fuera de `test/*.test.js`, así que no cambia el conteo; esto solo confirma que no rompió nada).

- [ ] **Step 6: Commit**

```bash
git add scripts/check-release-config.js package.json
git commit -m "chore(release): bloquear npm run release mientras el owner/repo de GitHub sea el placeholder"
```

---

### Task 3: Documentar la pasarela de descarga y los pasos de release

**Files:**
- Modify: `electron-app/README.md` (agregar sección al final)

**Interfaces:**
- Consumes: nada de las tareas anteriores (es solo documentación, pero
  referencia el mismo script/config que crearon).
- Produces: nada que otra tarea consuma.

- [ ] **Step 1: Agregar la sección al final de `electron-app/README.md`**

Agregar, después de la sección "## Notas de diseño" existente:

```markdown

## Distribución y actualizaciones

RunQA se distribuye como instalador de Windows (NSIS) vía GitHub Releases,
generado con `electron-builder` y actualizado en caliente con
`electron-updater`.

### Descargar la versión inicial

El instalador siempre está en:

```
https://github.com/{owner}/{repo}/releases/latest
```

donde `{owner}/{repo}` son los valores configurados en `package.json` →
`build.publish` (hoy todavía con un valor de ejemplo — ver
`scripts/check-release-config.js`, que bloquea publicar mientras siga así).
Ese archivo es la única fuente de verdad: no copies el owner/repo en ningún
otro lado, incluida esta sección.

### Cortar una release nueva

1. Subí la versión en `package.json` (campo `"version"`).
2. Probá el build localmente: `npm run dist`. Revisá `dist/` — debe generar
   `RunQA Setup <version>.exe`, `.exe.blockmap` y `latest.yml`.
3. Publicá: `GH_TOKEN=<token> npm run release`. El token necesita permiso
   `repo` sobre el repo configurado en `build.publish` (para crear el
   release y subirle assets). Si `owner`/`repo` siguen con el valor de
   ejemplo, el comando falla antes de tocar `electron-builder` y te dice qué
   campo falta.
4. `electron-builder` sube tres archivos al release de GitHub:
   - `RunQA Setup <version>.exe` — el instalador.
   - `RunQA Setup <version>.exe.blockmap` — permite que las instalaciones
     existentes bajen solo los bloques que cambiaron en vez del instalador
     entero.
   - `latest.yml` — lo que consulta `electron-updater` en cada máquina para
     saber si hay una versión más nueva.
```

- [ ] **Step 2: Revisar el render del Markdown**

Abrir `electron-app/README.md` y confirmar que la sección nueva quedó bien
formada (bloques de código cerrados, sin indentación rota) — revisión visual,
no hay comando automatizado para esto.

- [ ] **Step 3: Correr la suite completa**

Run: `npm test`
Expected: `224/224` pasan (cambio de solo documentación).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(distribucion): documentar la descarga inicial y los pasos para cortar una release"
```
