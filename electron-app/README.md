# RunQA — Electron

Aplicación de escritorio para el equipo de QA: ejecuta pruebas Playwright con
un clic, se mantiene actualizada, y dispara un flujo n8n que genera el
reporte Word. Este paquete contiene el **frontend completo** (ventana,
navegación, las 5 pantallas del diseño) más los puntos de integración ya
definidos como IPC handlers — falta conectar cada uno a tu backend real.

## Cómo correrla

```
cd electron-app
npm install
npm start
```

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

## Estructura

```
electron-app/
  main.js              proceso principal: crea la ventana + IPC handlers
  preload.js            puente seguro entre main y renderer (window.qa)
  renderer/
    index.html          shell de la app (titlebar + sidebar + <main>)
    styles.css           todo el sistema visual (colores, tipografía, componentes)
    renderer.js           lógica de UI: estado, render de las 5 pantallas, modales
  mock/
    tests-tree.json       árbol de pruebas de ejemplo (Suite > Archivo > Test)
    history.json           historial de ejecuciones de ejemplo
```

`renderer.js` habla con el proceso principal exclusivamente a través de
`window.qa` (expuesto por `preload.js`). Si abres `renderer/index.html`
directo en un navegador (fuera de Electron), un stub interno simula esas
respuestas para poder revisar el diseño sin levantar la app completa.

## Puntos de integración a conectar (todos están en `main.js`)

Cada uno hoy devuelve datos simulados — reemplaza el cuerpo del handler por
la llamada real. No requiere tocar el renderer.

- **`tests:getTree`** — leer el árbol de pruebas del repo Playwright local
  (p. ej. `playwright test --list --reporter=json` parseado a
  `{ id, name, files: [{ id, name, tests: [{ id, name }] }] }`).
- **`sync:checkStatus`** — comparar el commit local contra el remoto
  (equivalente a `git fetch` + comparar `HEAD`). Devuelve
  `{ updateAvailable, newTestsCount, lastSyncedAt }`.
- **`sync:update`** — hacer el `git pull` real; emitir progreso con
  `event.sender.send('sync:updateProgress', pct)` a medida que avanza.
- **`run:start`** — lanzar Playwright (`npx playwright test <ids> [--headed]`
  según `visualMode`), parsear su salida y emitir por cada línea:
  - `run:log` → `{ level: 'pass'|'fail'|'muted', text }` (consola en vivo)
  - `run:testResult` → `{ id, status: 'running'|'passed'|'failed' }`
  Si `stopOnFail` está activo, aborta el proceso hijo en el primer fallo.
- **`run:stop`** — matar el proceso hijo de Playwright en curso.
- **`report:generate`** — POST al webhook de n8n que arma el Word; devolver
  `{ docPath }` para poder abrirlo (`shell.openPath(docPath)` en Electron).
- **`history:list`** — leer el historial real (archivo local o respuesta de
  n8n) en vez de `mock/history.json`.

## Notas de diseño

- Ventana sin marco nativo (`frame: false`); la barra de título y sus
  controles (minimizar/maximizar/cerrar) son HTML propio, comunicados a
  `main.js` vía IPC (`window:minimize`, `window:maximize`, `window:close`).
- Un solo acento azul (`--accent` en `styles.css`) + verde/rojo semánticos
  para éxito/fallo. Cambiar el acento es editar esas variables CSS.
- El selector de proyecto (ERP / Medical / Finanzas) es una lista abierta en
  `renderer.js` (`const PROJECTS = [...]`) — agregar un proyecto es agregar
  un objeto ahí y que `tests:getTree`/`history:list` sepan responder por
  `projectId`.
- Todo el copy está en español neutro y evita jerga técnica (nunca dice
  "git pull", "commit", "build", etc.), como pide el equipo de QA.
