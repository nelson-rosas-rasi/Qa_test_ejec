# Backend del QA Test Runner — Rebanada 1: configurar, listar y ejecutar

**Fecha:** 2026-07-10
**Estado:** aprobado, pendiente de plan de implementación

## Problema

`electron-app/` es hoy un mockup completo: cinco pantallas funcionales cuyos datos
salen de `mock/tests-tree.json` y `mock/history.json`. Los siete puntos de
integración viven como handlers IPC en `main.js` y todos devuelven datos
simulados.

Esta rebanada conecta los tres handlers del bucle central —`tests:getTree`,
`run:start` y `run:stop`— contra un repositorio Playwright real. Al terminar, la
app deja de ser un mockup: lista las pruebas que existen de verdad, las ejecuta y
muestra sus resultados en vivo.

## Contexto descubierto

El repo de pruebas de referencia es `rasierp-e2e` (ERP de RASI). No es un
proyecto Playwright vacío: ya trae infraestructura que este diseño reutiliza en
vez de reimplementar.

- **`json-reporter.cjs`** — reporter propio, enganchado en `playwright.config.ts`.
  Al terminar la corrida escribe `.last-test-results.json` con resumen,
  agrupación por módulo, fallos con screenshot y detección de flaky.
- **`scripts/send-report.js`** — arma el payload de nueve secciones y lo postea al
  webhook de n8n, que genera un Google Doc a partir de una plantilla en Drive. Es
  decir, `report:generate` ya existe como CLI.
- **`n8n/workflow-qa-report.json`** — el flujo de n8n, versionado.
- **Perfiles de QA** — `playwright.config.ts` lee `QA_PROFILE` y carga
  `.env.<perfil>`. De ahí salen `TEST_USERNAME`, `TEST_PASSWORD`, `BASE_URL`,
  `QA_NOMBRE`, `QA_CARGO` y `N8N_WEBHOOK_URL`.

Datos reales verificados contra ese repo (`--list --reporter=json`, ejecutado sin
modificar nada):

- 19 archivos `.spec.ts`, **50 pruebas**, `@playwright/test` **1.58.2**.
- Casi todas las pruebas están anidadas dentro de bloques `describe`; el JSON de
  `--list` requiere recorrido recursivo.
- `rootDir` y `testDir` son ambos `<repo>/tests`, así que el `file` de cada prueba
  viene relativo a `tests/` y con separadores `/` (`cartera/nota-credito-clientes.spec.ts`).
- Cada prueba trae `file`, `line` y `column`.
- Carpetas: `cartera`, `comun`, `cuentas-por-pagar`, `tesoreria`, `ventas`, más
  `smoke.spec.ts` en la raíz.

También se verificó que **Playwright arranca bajo el Node que trae Electron**
(`process.execPath` con `ELECTRON_RUN_AS_NODE=1`), con código de salida 0. El QA
no necesita Node instalado.

## Decisiones

### 1. Reporter NDJSON propio para el streaming

Playwright acepta `--reporter=<ruta a un .js>`. Le inyectamos un reporter mínimo
que imprime una línea JSON por evento (`testBegin`, `testEnd`, `stdout`). El
backend lee stdout línea a línea y lo traduce a los eventos IPC que el renderer ya
espera.

Se descartó parsear la salida de texto de `--reporter=line`: es una salida
pensada para humanos, cambia entre versiones, trae colores ANSI y los errores
multilínea son ambiguos. Se descartó `--reporter=json` a secas: solo emite al
final, y eso mata la pantalla "Ejecución en vivo".

**El reporter se suma, no reemplaza.** Pasar `--reporter=X` por CLI pisa la lista
del config, lo que eliminaría `json-reporter.cjs` — justo el que alimenta el
reporte de n8n. Por eso se pasan ambos:

```
--reporter=./json-reporter.cjs,<ruta absoluta al ndjson-reporter.cjs>
```

`run-tests.js` no adivina nada: recibe la lista de reporters extra como
argumento. Es `ipc.js` quien comprueba si `<repo>/json-reporter.cjs` existe y lo
añade. Así el módulo puro se prueba contra un repo de juguete que no lo tiene.

`list` y `html` se omiten durante las corridas de la app: la consola en vivo
reemplaza a `list`, y `html` abriría un navegador al terminar.

**Sentinela.** `json-reporter.cjs` también escribe en stdout (`console.log`). Para
distinguir nuestras líneas, el reporter NDJSON las prefija con `@@QATR@@`. El
parser ignora toda línea sin ese prefijo.

### 2. Identidad de las pruebas: `archivo:línea`

Los ids del árbol pasan de `t1`, `t2`… a `cartera/nota-credito-clientes.spec.ts:22`,
formados con el `file` y el `line` que devuelve `--list`, sin transformarlos.
Es exactamente lo que Playwright acepta como selector, así que el mismo id sirve
para listar y para ejecutar. No hay `--grep` con títulos, que se confunde con
títulos duplicados y con tildes.

Verificado contra el repo real: pasar `cartera/nota-credito-clientes.spec.ts:22`
como filtro selecciona exactamente una prueba.

Cuando el QA elige "Ejecutar todos" no se pasa ningún filtro, en vez de enumerar
las 50 pruebas. Es más rápido y evita el límite de longitud de la línea de
comandos en Windows.

El renderer trata los ids como cadenas opacas: no requiere cambios.

### 3. Agrupación: Suite = carpeta

El renderer espera tres niveles (Suite → Archivo → Prueba). Playwright no tiene
"suites" en ese sentido. Mapeamos **Suite = primer segmento del `file`**
(`ventas/ventas-ui.spec.ts` → suite `ventas`). Los archivos sin carpeta
(`smoke.spec.ts`) caen en una suite llamada **General**.

El nombre de la suite es el de la carpeta tal cual, en minúsculas (`cuentas-por-pagar`).
No se embellece ni se traduce: inventar nombres bonitos obligaría a mantener un
diccionario que se desincroniza en cuanto alguien crea una carpeta.

El nombre visible de cada prueba es `describe > título` cuando está anidada,
igual que hace hoy `json-reporter.cjs` con `titlePath()`.

### 4. Perfiles de QA en el sidebar

`profiles.js` lista los archivos `.env.*` del repo (ignorando `.example`), lee de
cada uno `QA_NOMBRE` y `QA_CARGO`, y los ofrece en el sidebar, donde hoy está fija
"María Gómez · QA Lead". El perfil elegido se guarda por proyecto y viaja como
`QA_PROFILE` en cada corrida.

**`TEST_PASSWORD` nunca se lee, ni se copia, ni se muestra.** Solo se leen las dos
claves necesarias para el nombre visible.

Sin perfil, las pruebas corren con credenciales vacías y fallan todas en el login.
Por eso esto entra en la rebanada 1 aunque el mockup no lo contemple.

### 5. Lanzar Playwright con el Node de Electron

```
process.execPath
  args: [<repo>/node_modules/playwright/cli.js, test, ...ids, --reporter=..., --headed?, --max-failures=1?]
  cwd:  <repoPath>
  env:  { ...process.env, ELECTRON_RUN_AS_NODE: '1', QA_PROFILE: <perfil> }
```

Se usa el Playwright **del repo**, no un `npx` global: es la única forma de correr
la misma versión con la que el equipo escribió las pruebas. Si
`node_modules/playwright/cli.js` no existe, el error es explícito y accionable.

## Arquitectura

```
electron-app/
  main.js                    ventana + registro de handlers (~40 líneas)
  main/
    ipc.js                   único módulo que conoce Electron; traduce errores
    errors.js                errores con código (appError)
    config-store.js          userData/config.json
    profiles.js              lista .env.* y lee QA_NOMBRE / QA_CARGO
    playwright/
      locate.js              encuentra node_modules/playwright/cli.js
      build-tree.js          JSON de --list → árbol de 3 niveles (puro)
      list-tests.js          lanza --list --reporter=json y llama a build-tree
      events.js              parser NDJSON + traducción a eventos IPC (puro)
      run-tests.js           spawn, matar árbol de procesos, resumen
      ndjson-reporter.cjs    se inyecta a Playwright; una línea JSON por evento
```

`build-tree.js` y `events.js` se separan de sus módulos de proceso para poder
probarlos sin lanzar nada.

**`ipc.js` es el único módulo que importa `electron`.** Todos los demás se prueban
con Node a secas, sin levantar la app.

- `config-store.js` recibe la carpeta de configuración como argumento; es `ipc.js`
  quien le pasa `app.getPath('userData')`. Así se prueba contra un directorio
  temporal.
- `list-tests.js` recibe una ruta de repo y devuelve un árbol.
- `run-tests.js` recibe ids, opciones y un callback de eventos. No sabe qué es IPC.
- `ipc.js` traduce ese callback a `event.sender.send(...)` y los errores a diálogos.

## Contratos

### `config.json` (en `app.getPath('userData')`)

```json
{ "projects": { "erp": { "repoPath": "C:/qa/rasierp-e2e", "profile": "Nelson_vid" } } }
```

Ni tokens ni URLs remotas todavía: eso llega con la rebanada de git.

### `tests:getTree(projectId)`

Devuelve el mismo shape que hoy — el renderer no cambia:

```json
[{ "id": "ventas", "name": "ventas",
   "files": [{ "id": "ventas/ventas-ui.spec.ts", "name": "ventas-ui.spec.ts",
               "tests": [{ "id": "ventas/ventas-ui.spec.ts:22", "name": "describe > título" }] }] }]
```

Si el proyecto no tiene `repoPath`, el proceso principal abre el diálogo nativo de
carpetas ("Elige la carpeta del proyecto ERP"), guarda la elección y continúa. No
se construye una pantalla de ajustes en esta rebanada.

### `run:start({ testIds, visualMode, generateReport, stopOnFail })`

- `visualMode` → `--headed`
- `stopOnFail` → `--max-failures=1`
- `generateReport` → se ignora en esta rebanada (sigue simulado)

Traducción de eventos del reporter a IPC:

| Evento del reporter | Evento IPC |
|---|---|
| `testBegin` | `run:testResult` → `{ id, status: 'running' }` |
| `testEnd` `passed` | `run:testResult` → `passed` + `run:log` nivel `pass` |
| `testEnd` `failed` / `timedOut` / `interrupted` | `run:testResult` → `failed` + `run:log` nivel `fail` con el mensaje de error |
| `testEnd` `skipped` | solo `run:log` nivel `muted`; la prueba queda en `pending` |
| `stdout` de la prueba | `run:log` nivel `muted` |

**Retries.** `playwright.config.ts` usa `retries: 1`, así que una prueba inestable
emite `testEnd` más de una vez. Al reintentar se emite `running` de nuevo; el
último intento manda. Una prueba que falla y luego pasa termina en `passed`, con
una línea `muted` en la consola avisando que fue flaky.

Retorna un resumen en vez del `{ ok: true }` actual:

```json
{ "ok": true, "summary": { "passed": 47, "failed": 2, "skipped": 1, "durationMs": 184320 } }
```

El renderer ignora el valor de retorno, así que el cambio es seguro. Lo necesitará
la rebanada de reportes.

### `run:stop`

Mata el **árbol** de procesos, no solo el hijo directo: Playwright lanza
navegadores como nietos y un `kill` simple los deja huérfanos. En Windows,
`taskkill /pid <pid> /T /F`; en macOS y Linux, matar el grupo de procesos
(`spawn` con `detached: true` y `process.kill(-pid)`).

## Errores

Los módulos lanzan errores con código:

| Código | Cuándo | Mensaje al QA |
|---|---|---|
| `REPO_NOT_CONFIGURED` | no hay `repoPath` y el QA canceló el diálogo | "No elegiste una carpeta para este proyecto." |
| `PLAYWRIGHT_NOT_INSTALLED` | falta `node_modules/playwright/cli.js` | "Este proyecto no tiene sus dependencias instaladas." |
| `NO_PROFILE` | el repo no tiene ningún `.env.*` | "No hay perfiles de QA configurados en este proyecto." |
| `LIST_FAILED` | `--list` salió con error o el JSON trae `errors[]` | el error de compilación tal cual |

`ipc.js` los atrapa y, como el renderer todavía no tiene estados de error, muestra
un diálogo nativo de Electron con el mensaje en español y devuelve un árbol vacío.
Cuando se construya la pantalla de configuración, estos errores se mueven ahí.

## Empaquetado

El reporter es un archivo que lee un proceso hijo ajeno a Electron. Al empaquetar
con electron-builder queda dentro de `app.asar`, que solo Electron sabe leer:
Playwright no podría abrirlo. Hay que marcarlo en `package.json`:

```json
"build": { "asarUnpack": ["main/playwright/ndjson-reporter.cjs"] }
```

…y resolver la ruta hacia `app.asar.unpacked`. Es una línea, pero si se olvida la
app funciona en desarrollo y falla en el instalador.

## Pruebas

Runner: `node:test`, incluido en Node. Cero dependencias nuevas.

Se escribe cada prueba antes que su implementación.

- **Repo Playwright de juguete** en `electron-app/test-fixtures/sample-repo/`: dos carpetas,
  tres `.spec.ts`, con una prueba que pasa, una que falla y una que se salta. Es
  el material de las pruebas de integración. El repo real corre contra un ERP en
  producción con credenciales reales: no sirve como material de una suite
  automatizada.
- **Constructor del árbol** (puro): fixture del JSON de `--list` real →
  agrupamiento por carpeta, ids `archivo:línea`, `describe > título`, archivos en
  la raíz bajo "General", y el caso de `errors[]` no vacío.
- **Traductor de eventos** (puro): líneas NDJSON, incluidas líneas **partidas a la
  mitad** —lo que realmente ocurre al leer un stream— y el caso de retry.
- **`locate.js`**: repo con Playwright, repo sin él.
- **`profiles.js`**: repo con dos `.env.*`, repo sin ninguno, y que
  `TEST_PASSWORD` no aparece en la salida.
- **Apagado** (integración real): se arranca una corrida larga en el repo de
  juguete, se mata, y se confirma que no quedan procesos vivos.

## Orden de construcción

Cada paso deja la app usable.

Se construyen primero todos los módulos puros, con sus pruebas, sin tocar la app.
Solo cuando están verdes se cablean.

1. `errors.js`, `config-store.js`, `profiles.js` — probados contra directorios
   temporales.
2. Repo Playwright de juguete, `locate.js`, `build-tree.js`, `list-tests.js`.
3. `ndjson-reporter.cjs`, `events.js`, `run-tests.js`, incluido el apagado.
4. Cablear: partir `main.js`, crear `ipc.js`, ampliar `preload.js`. **Primer
   momento en que se nota el cambio al abrir la app.**
5. Selector de perfil en el sidebar.
6. `asarUnpack` y verificación de punta a punta.

Partir `main.js` ocurre en el paso 4 y no antes: hasta entonces no hay nada que
cablear. Los handlers que siguen simulados se mueven **verbatim** en ese mismo
commit, para que mover código y cambiar comportamiento no se mezclen.

## Fuera de alcance

Siguen con datos simulados, y cada uno tendrá su propio spec:

- Clonar un repo por URL y el token de acceso cifrado (`safeStorage`).
- `sync:checkStatus` y `sync:update` (detectar y traer actualizaciones).
- `report:generate` — envolver lo que `scripts/send-report.js` ya hace.
- `history:list` — historial local primero, con la puerta abierta a un servicio
  Spring Boot más adelante.
- Una pantalla de configuración en condiciones.

## Cabos sueltos anotados

- **`docPath` en el historial.** El botón "Abrir reporte" de la pantalla Historial
  no tiene a dónde apuntar si n8n solo confirma con un `200`. Pero
  `scripts/send-report.js` ya contempla un campo `documentUrl` en la respuesta.
  Hay que revisar el nodo de respuesta de `n8n/workflow-qa-report.json` antes de
  diseñar esa rebanada.
- **Versión de Playwright.** El `package.json` de `rasierp-e2e` declara `^1.50.0`
  pero lo instalado es `1.58.2`. No afecta a este diseño; vale la pena que el
  equipo lo sepa.
