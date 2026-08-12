# RunQA Setup: bootstrapper de prerequisitos — Diseño

Fecha: 2026-08-06
Estado: aprobado
Alcance: **nuevo proyecto `setup/`** (hermano de `electron-app/`) + un cambio acotado en RunQA

## Contexto

El spec [2026-07-27-distribucion-urgente-design.md](2026-07-27-distribucion-urgente-design.md)
acotó la ronda anterior a "lo que bloquea distribuir la app tal como está hoy" y
dejó explícitamente fuera la pieza A completa: *asistente de primer arranque,
verificación de Git/Node/Playwright, instalación controlada de dependencias y
navegadores*, anotada como "un spec propio más adelante". **Este es ese spec.**

Hoy RunQA se distribuye con un instalador web NSIS (`nsis-web`) que funciona: el
release v1.5.1 publicó `RunQA-Installer-1.5.1.exe` (781 KB),
`runqa-1.5.1-x64.nsis.7z` (77 MB) y `latest.yml`. Pero ese instalador **solo
descarga la app**: no prepara nada del entorno. Y el chequeo de runtime que
cubría parte del hueco se eliminó en `aa00ea9` ("fix: start RunQA without runtime
gateway"), quedando además prohibido su regreso por
`electron-app/test/startup-contract.test.js`. La decisión de sacarlo de la app se
tomó; el setup que debía reemplazarlo nunca se construyó.

### Qué falta hoy en una máquina Windows limpia

| Requisito | Quién lo resuelve hoy | Síntoma en máquina limpia |
|---|---|---|
| Electron + RunQA | `nsis-web` | ok |
| `client_id` de GitHub | compilado en `main/github/config.js:7` | ok |
| URL del backend | compilado en `main/ipc.js:65` | ok |
| **git en el PATH** | nadie | `spawn git ENOENT` → *"No fue posible acceder al repositorio."* |
| **Node + npm en el PATH** | nadie | `spawn npm.cmd ENOENT` → *"No fue posible instalar las dependencias del proyecto."* |
| **Navegadores de Playwright** | nadie | *"Executable doesn't exist at …ms-playwright\chromium-1208"* |

Lo de los navegadores es un hallazgo propio de esta ronda: `@playwright/test@1.58.2`
**ya no trae `postinstall`** (`scripts: {}` en el paquete instalado), y en todo
`electron-app/main/` no existe ninguna llamada a `playwright install`. Es decir:
aun con git y Node presentes, la primera corrida falla.

RunQA sí lanza Playwright sin Node externo, usando `process.execPath` con
`ELECTRON_RUN_AS_NODE` (`main/playwright/run-tests.js:42`,
`main/runtime/node-process.js`). El Node externo hace falta solo por `npm ci`.

## Decisiones tomadas

Se evaluaron tres enfoques: (A) un setup aparte con su propia vista, (B) una
macro `customInstall` dentro del NSIS actual, y (C) eliminar los prerequisitos
empaquetando MinGit y npm dentro de RunQA. **Se eligió A.** Queda registrado que
C evita el UAC, el artefacto extra y la firma adicional, y que se descartó a
favor de una experiencia explícita y visible para el QA.

Decisiones cerradas en el brainstorming:

- Los QA **son administradores** de su equipo → instalación silenciosa para toda
  la máquina, con UAC.
- Los **navegadores los prepara el setup**, con versión fijada (no la app).
- El setup es una **app Electron** con la identidad visual de RunQA (~90 MB), no
  un asistente NSIS ni un script de PowerShell.
- El setup es el **único punto de entrada**: termina descargando y ejecutando el
  instalador de RunQA.

## Fuera de alcance (YAGNI)

- macOS y Linux. El setup es solo Windows x64.
- Desinstalar prerequisitos: el setup instala y repara, nunca remueve.
- Elegir navegadores a la carta: se instalan los tres que trae
  `playwright install` por defecto (~500 MB).
- Firma de código. Sigue ausente en todo el pipeline; ver "Riesgos".
- Empaquetar git/npm dentro de RunQA (enfoque C, descartado arriba).

## Arquitectura

### Artefacto

Proyecto nuevo `setup/`, hermano de `electron-app/`, con su propio
`package.json` y su propia config de `electron-builder`. Se publica con el target
`portable` (un `.exe` suelto, sin instalación previa) como
`RunQA Setup <versión>.exe`, con `requestedExecutionLevel: requireAdministrator`:
**un solo UAC al abrir**, heredado por todo lo que lance.

Restricción derivada: el QA debe ejecutarlo con **su propia cuenta de
administrador**. Si eleva con credenciales de otro admin, `%LOCALAPPDATA%` pasa a
ser el de esa otra cuenta y los navegadores quedan en un perfil que RunQA no va a
leer. Va advertido en la pantalla de bienvenida.

### Versionado independiente

El setup **no se rearma en cada release de RunQA**: su último paso resuelve el
release más reciente vía la API de GitHub y descarga el `RunQA-Installer-*.exe`
que encuentre ahí. Se toca solo cuando cambia un prerequisito. Versiona aparte,
con tags `setup-v*.*.*`.

### Flujo

```
detectar  →  plan  →  ejecutar (con progreso)  →  verificar  →  resumen
```

1. **Detectar** — busca `git`, `node`, `npm` y la caché `%LOCALAPPDATA%\ms-playwright`.
   Devuelve un estado puro; no instala nada. El QA ve la lista completa (✓ / falta)
   y recién ahí confirma.
2. **Git para Windows** — instalador oficial fijado por versión,
   `/VERYSILENT /NORESTART /NOCANCEL`.
3. **Node.js 22 LTS** — MSI oficial, `msiexec /i … /qn /norestart`.
4. **Navegadores** — `playwright@<versión fijada> install` invocado con el
   `npx.cmd` recién instalado, por ruta absoluta.
5. **RunQA** — descarga el instalador del último release y lo ejecuta. El
   asistente NSIS de siempre toma el control y el setup se cierra.

**Verificar** no es una pantalla: después de cada paso 2-4 el setup vuelve a
correr la detección de ese requisito por ruta absoluta y solo entonces lo marca
`done`. Un instalador que devuelve código 0 pero no dejó el binario donde
corresponde se detecta ahí, no tres pantallas después.

Los pasos ya satisfechos se saltan: reabrir el setup funciona como **reparador**,
que es exactamente lo que hace falta cuando los navegadores quedan a medias.

Las versiones concretas de git y Node (y sus sha256) se fijan al escribir
`prerequisites.json` durante la implementación, tomando la última LTS vigente en
ese momento. Node queda anclado a la línea 22 LTS.

### El detalle que hace o rompe esto: el PATH

Después de instalar git y Node, el PATH nuevo **no existe** en el proceso del
setup — Windows solo lo propaga a procesos creados después del
`WM_SETTINGCHANGE`. Por eso el setup **nunca verifica por PATH**: resuelve por
ruta absoluta (`C:\Program Files\Git\cmd\git.exe`,
`C:\Program Files\nodejs\npm.cmd`).

El mismo problema alcanza a RunQA cuando el instalador lo abre con "Ejecutar
RunQA" al terminar: ese proceso hereda el PATH viejo del instalador. De ahí el
único cambio del lado de la app en este spec:
`electron-app/main/projects.js:77` debe resolver `git`/`npm` con **fallback a
esas rutas conocidas** en vez de confiar solo en el PATH.

## Componentes

Mismo patrón que ya usa `electron-app/main/projects.js`: funciones puras con el
ejecutor inyectado (`run = runFile`), para poder testear sin tocar el sistema.

```
setup/
  prerequisites.json     única fuente de verdad de las versiones fijadas
  main.js  preload.js
  main/
    detect.js       detectPrerequisites({exists, run}) → estado puro
    steps.js        planSteps(estado) → pasos a ejecutar, saltando lo instalado
    releases.js     resuelve el RunQA-Installer-*.exe del último release
    download.js     descarga con progreso + verificación sha256
    paths.js        rutas absolutas conocidas de git/node/npm/npx
    installers/     git.js  node.js  browsers.js  runqa.js
    log.js          %LOCALAPPDATA%\RunQA Setup\setup.log
  renderer/         index.html  setup.js  styles.css
  test/             *.test.js  (node:test)
```

`prerequisites.json` contiene versión + URL + sha256 de git y Node, y la versión
fijada de Playwright. **Subir un prerequisito es editar ese archivo y nada más.**

`renderer/styles.css` reusa los mismos tokens visuales de RunQA (el acento azul,
la tipografía). Es duplicación deliberada: son dos artefactos independientes y no
justifica un paquete compartido para un puñado de variables CSS.

## Flujo de datos

Un solo canal IPC de estado, igual que el que publica `main/updater.js:22-27`:

```
setup:state → { steps: [{ id, label, status, percent }], current, error }
```

`status` ∈ `pending | running | done | error`. El renderer solo pinta ese estado;
toda la lógica vive en `main/`.

## Manejo de errores

- **Por paso, aislado.** Un paso que falla queda en `error` con mensaje en
  español neutro, botón **Reintentar** (re-corre solo ese paso) y **Ver
  detalles** (abre `setup.log`).
- **Descarga corrupta.** El sha256 es obligatorio; si no coincide se borra el
  archivo y se informa "la descarga se corrompió", no "error 1603".
- **Sin red o proxy corporativo.** El mensaje nombra el host que no respondió
  (`github.com`, `nodejs.org`), que es el dato que TI necesita para desbloquear.
- **UAC rechazado.** La app no llega a abrir; lo exige el manifiesto. No hay
  nada que manejar en código.
- **Desalineación de la versión de Playwright.** Es la consecuencia directa de
  fijar la versión en el setup: si un repo de pruebas trae otro
  `@playwright/test`, `npm ci` instalará esa versión y los navegadores fijados no
  le servirán. Hoy eso revienta con `Executable doesn't exist at …`. RunQA pasa a
  comparar la versión del repo (leyendo `node_modules/playwright-core/package.json`)
  contra los navegadores presentes y, si no coinciden, muestra: *"Este proyecto
  necesita los navegadores de Playwright X.Y — abrí RunQA Setup y ejecutalo de
  nuevo"*. El setup sigue siendo el único dueño de los navegadores; lo que cambia
  es que el fallo deja de ser críptico.

## Pruebas

`node --test`, sin dependencias nuevas, igual que el resto del repo.

En `setup/`:

- `detect`: con `exists`/`run` inyectados — git presente, git ausente, versión
  ilegible, caché de navegadores parcial.
- `steps`: el plan salta lo ya instalado, respeta el orden, y RunQA es siempre el
  último paso.
- `releases`: parsea la respuesta de la API y elige el asset correcto; falla
  claro si el release no tiene assets.
- `download`: sha256 correcto e incorrecto.
- `prerequisites.json`: campos completos y URLs `https`.

En `electron-app/`:

- El fallback de rutas de `git`/`npm` cuando el PATH no las tiene.
- El aviso de navegadores desalineados.

**Verificación manual** (no automatizable): sobre una VM limpia de Windows 11
x64, sin git ni Node, ejecutar el `.exe` y confirmar los cinco pasos, el
reintento tras cortar la red a mitad de una descarga, y que reabrir el setup los
salte todos. El checklist vive junto al plan de implementación.

## CI y publicación

Workflow propio `release-setup.yml`, disparado por tags `setup-v*.*.*`, con la
misma forma que `release-runqa.yml`: `npm ci`, `npm test`, y build+publish del
target `portable` en Windows.

## Riesgos aceptados

1. **Sin firma de código.** SmartScreen aparecerá también en el setup, que ahora
   es el primer contacto del QA con el producto — más incómodo que antes.
   Pendiente transversal, no de este spec.
2. **~90 MB para un setup** que instala una app de 77 MB. Es el precio de la
   opción elegida sobre un asistente NSIS de ~2 MB.
3. **Versión de Playwright fijada** frente a repos que evolucionan: mitigado con
   el mensaje accionable descrito arriba, no eliminado.
