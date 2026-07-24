# Resultados y reportes — persistir corridas, guardar/n8n y métricas

**Fecha:** 2026-07-22
**Estado:** aprobado, pendiente de plan de implementación
**Spec hermano:** Configuración (editar perfil, carpeta del repo, URL de n8n, gestión
de perfiles) irá en un spec aparte y posterior. Aquí solo se **lee** la URL de n8n.

## Problema

La pantalla de **Resultados** hoy no muestra datos reales: si no hay una corrida
reciente en memoria, inventa cifras (`30 pruebas, 26 exitosas, 4 fallidas`),
duración fija (`"3m 42s"`) y errores de ejemplo ([renderer.js:966](../../electron-app/renderer/renderer.js)).
Nada se guarda entre sesiones, no se distingue si una corrida fue individual o en
conjunto, y no hay filtros ni registro de reportes.

Además, el flujo de reporte está incompleto: existe un toggle *"Generar reporte
Word al finalizar"* **antes** de correr, pero `report:generate` e `history:list`
son stubs ([ipc.js:279-281](../../electron-app/main/ipc.js)) — devuelven rutas
inventadas y **n8n nunca se dispara**. No hay almacenamiento local de resultados
ni forma de decidir, tras ver el resultado, si esa corrida merece conservarse.

## Alcance

1. **Persistir cada corrida localmente** (detalle por test incluido), fuera del
   clon, para que sobreviva entre sesiones.
2. **Decisión de guardado tras la corrida:** Descartar / Guardar solo local /
   Guardar y generar documentación (n8n). El guardado local no depende de n8n.
3. **Disparo real de n8n** (POST al webhook) cuando el usuario lo pide.
4. **Rehacer la pantalla Resultados** como hub único: registro filtrable de
   corridas guardadas + detalle de corrida + métricas de errores por test
   seleccionado. Absorbe la pantalla **Historial**, que se elimina.

**Fuera de alcance:**

- **Editar la URL de n8n, editar perfiles, abrir la carpeta del repo, renombrar/
  eliminar perfiles.** Todo eso es el spec de **Configuración** (posterior). Aquí
  la URL de n8n solo se **lee**.
- **Cambiar el `playwright.config.ts` del repo de pruebas.** La app añade el
  reporter `html` por línea de comandos (que ya sobreescribe la config del repo,
  como hoy hace con el ndjson), sin tocar el repo.
- **"Pausar y reanudar" una corrida.** Playwright no lo tiene. "Detener en el
  primer fallo" (`--max-failures=1`) ya existe como `stopOnFail` y se conserva
  tal cual; no es trabajo de este spec.
- **Índice/paginación del registro.** Para el volumen esperado (decenas de
  corridas) leer los JSON directo basta; un índice es evolución futura.

## Decisiones tomadas

1. **El reporte se genera siempre local; guardar es una decisión posterior.**
   Playwright produce su reporte HTML en cada corrida. Al terminar, el usuario
   elige: Descartar (nada se persiste), Guardar solo local (registro + copia del
   reporte, sin n8n) o Guardar y generar documentación (además POST a n8n). El
   caso de uso es el tanteo: una prueba de ensayo se descarta y no ensucia ni el
   registro local ni la documentación oficial.
2. **Un archivo JSON por corrida**, no un `runs.json` que crece y se reescribe
   entero. Más robusto ante corrupción y sin condiciones de carrera al guardar.
   El volumen bajo hace que leer la carpeta al listar sea trivial.
3. **Los resultados viven fuera del clon**, en `userData/results/<proyecto>/`,
   igual que los perfiles cifrados y la config. Sobreviven a reclonados y a
   actualizaciones de rama.
4. **`mode` (individual/conjunto) se deriva del tamaño de la corrida**, no es un
   campo que el usuario elija: 1 test → `individual`; varios o "todos" →
   `conjunto`. Refleja **cómo se ejecutó**, tal como se pidió.
5. **Resultados absorbe a Historial.** Tener dos pantallas de "registro de
   corridas" era redundante. Se elimina el ítem Historial del sidebar.
6. **Copy sin jerga técnica.** La acción de n8n se llama en la UI **"Guardar y
   generar documentación"**; "n8n" queda solo en el código. Coherente con la
   regla del proyecto (sin "git pull", "commit", "webhook" en texto visible).

## Diseño

### 1. `main/results/store.js` — almacén de corridas

`createResultsStore({ dir })`, sin dependencias de Electron (recibe el
directorio, testeable contra un temporal), un archivo por corrida bajo
`dir/<proyecto>/run-<ts>.json` y la copia del reporte en `dir/<proyecto>/run-<ts>/report/`:

```
userData/results/<projectId>/
   run-<timestamp>.json        registro de la corrida
   run-<timestamp>/report/     copia del reporte HTML (solo si se guardó)
```

API:

- `save(record)` — escribe (o sobreescribe, idempotente por `id`) el JSON.
- `list(projectId)` → `[record]` ordenadas por `finishedAt` desc; una corrida con
  JSON ilegible se omite, no rompe el listado.
- `get(projectId, runId)` → `record` o `null`.
- `remove(projectId, runId)` — borra el JSON y su carpeta `report/`.
- `reportDir(projectId, runId)` / `runFileExists(...)` — utilidades de ruta para
  que `ipc.js` copie el reporte y `shell.openPath` lo abra.

### 2. Modelo del registro (`run-<ts>.json`)

```jsonc
{
  "id": "run-1721600000000",
  "projectId": "erp", "projectName": "ERP Ventas",
  "profileId": "maria-gomez", "profileName": "María Gómez",
  "startedAt": "2026-07-22T14:03:00.000Z",
  "finishedAt": "2026-07-22T14:06:42.000Z",
  "durationMs": 222000,
  "mode": "conjunto",                 // "individual" (1 test) | "conjunto"
  "runAll": false,
  "options": { "visualMode": false, "stopOnFail": false },
  "summary": { "total": 30, "passed": 26, "failed": 4, "skipped": 0 },
  "tests": [
    { "id": "cartera/pago.spec.ts:8", "name": "pago rechazado",
      "status": "failed", "durationMs": 3400,
      "error": "AssertionError: el resultado no coincide con lo esperado" }
  ],
  "report": { "kind": "playwright-html", "path": "run-1721600000000/report" },
  "n8n": { "sent": true, "at": "2026-07-22T14:07:12.000Z", "ok": true, "error": null }
}
```

`report` es `null` si no se copió (ver Errores). `n8n.sent=false` para "solo
local"; `sent=true, ok=false` para un envío que falló y se puede reintentar.

### 3. Captura del reporte HTML — `main/playwright/run-tests.js`

- **Se añade el reporter `html` de Playwright** a la lista de reporters
  (`reportersFor` en `ipc.js`), en modo "no abrir": el proceso hijo se lanza con
  `PLAYWRIGHT_HTML_OPEN=never` en el env, para que no abra un navegador al
  terminar. Escribe en `playwright-report/` del clon (destino por defecto). Como
  el `--reporter` de la CLI ya sobreescribe la config del repo, no hay duplicados.
- El reporte en `playwright-report/` es **efímero**: la corrida siguiente lo pisa.
  Solo se conserva si el usuario guarda; ahí `ipc.js` copia esa carpeta al almacén.
- **`run-tests.js` acumula el detalle por test.** Hoy el `feed` ya recibe cada
  `record` del ndjson-reporter (que emite `id, name, status, retry, willRetry,
  durationMs, error`). Se acumula `{ id, name, status, durationMs, error }` del
  último `testEnd` no-reintento de cada test, y se incluye en el objeto que
  resuelve la promesa, junto al `summary` actual:

  ```js
  resolve({ ok, stopped, summary, tests: [...] })
  ```

  Sin cambios en `events.js` ni en el ndjson-reporter: los campos ya existen.

### 4. Construcción del registro y guardado — `main/ipc.js`

- **`run:start`** arma, al resolver, el registro completo salvo `report`/`n8n`
  (que dependen de la decisión posterior) y lo guarda en memoria como
  `lastRun` (una sola corrida a la vez; una nueva corrida reemplaza la anterior
  no guardada). Deriva `mode`, `projectName`/`profileName` desde la config y el
  store de perfiles, y sella `startedAt`/`finishedAt`/`durationMs`.
- **`results:save(_e, runId, { toN8n })`**:
  1. Verifica que `runId === lastRun.id` (si no, la corrida ya fue pisada →
     `RUN_EXPIRED`).
  2. Copia `playwright-report/` **del clon de `lastRun.projectId`** (no del
     proyecto "actual", que pudo cambiar entre correr y guardar) a
     `results/<proyecto>/run-<id>/report/` si existe; si no, `report=null`.
  3. Si `toN8n`, llama a `notifyN8n(record)` (sección 5) y sella `record.n8n`.
  4. `store.save(record)` y devuelve `{ ok, record }`.
- **`results:list` / `results:get` / `results:remove`** — pasan al store.
- **`results:resendN8n(_e, projectId, runId)`** — relee el registro, hace el POST,
  actualiza `record.n8n`, re-guarda. Devuelve `{ ok, n8n }`.
- **`results:openReport` / `results:openFolder`** — `shell.openPath` al
  `index.html` del reporte copiado y a la carpeta de la corrida.
- Se **retiran** los handlers stub `report:generate` e `history:list`.

### 5. `main/results/notify-n8n.js` — el POST a n8n

`notifyN8n(record, { url, fetchImpl = fetch })` → `{ ok, at, error }`:

- **URL:** la resuelve `ipc.js` antes de llamar: ajuste de proyecto
  `n8nWebhookUrl` en `config-store` (que el spec de Configuración editará), con
  respaldo al valor `N8N_WEBHOOK_URL` del perfil activo si está presente. Si no
  hay ninguna, `ipc.js` responde `N8N_NOT_CONFIGURED` sin intentar el POST.
- **Payload:** el registro de la corrida (proyecto, perfil, modo, `summary`,
  `tests`). `notify-n8n.js` no conoce Electron; recibe `fetchImpl` para poder
  inyectar un doble en los tests. `fetch` es global en el Node del proceso
  principal (Electron 30 → Node 20).
- **Fallo/timeout:** no lanza; devuelve `{ ok:false, error }`. La corrida se
  guarda local igual y queda disponible el **Reenviar**.

> **Supuesto a confirmar con el equipo:** la forma exacta del payload que espera
> el flujo n8n. Se define un JSON razonable (el registro) y se ajusta si el flujo
> real espera otra cosa. No bloquea este spec.

### 6. IPC, preload y stub del navegador

`preload.js` expone: `saveResults`, `listResults`, `getResult`, `removeResult`,
`resendResultN8n`, `openResultReport`, `openResultFolder`. Se quitan
`generateReport` y `getHistory`.

El `createBrowserStub` del renderer gana esos métodos con datos de ejemplo
(varias corridas, individual y conjunto, alguna con fallos) para que el diseño
siga navegable abriendo `index.html` fuera de Electron.

### 7. Renderer — pantalla Resultados

Reemplaza `renderResults` y elimina `renderHistory` y su ítem de sidebar
(`index.html`). Un control de dos pestañas; el **detalle** es un drill-down.

**Pestaña "Registro"** (por defecto):

```
[ Registro ]   [ Métricas por test ]

[Resultado ▾] [Modo ▾] [Perfil ▾] [Últimos 30 días ▾]      🔍 Buscar test…

 22 jul, 14:06 · María Gómez · Conjunto · 30 pruebas
   ✗ 4 fallidas         [n8n ✓]        Ver detalle · Abrir reporte
 22 jul, 11:20 · Julián Ríos · Individual · login.spec.ts:22
   ✓ Pasó               [solo local]   Ver detalle · Abrir reporte
```

- Cada fila: fecha, perfil, **modo** (Individual → nombre del test; Conjunto → nº
  de pruebas), resultado, estado n8n (`enviado` / `solo local` / `Reenviar`),
  acciones (Ver detalle, Abrir reporte, Abrir carpeta).
- Filtros: **resultado** (Todas / Todas pasaron / Con fallos), **modo**
  (Individual / Conjunto), **perfil**, **fecha** (7/30/90 días / Todo),
  **búsqueda por test** (corridas que incluyan un test cuyo nombre/id coincida).
- Estado vacío: *"Aún no has guardado ninguna corrida."*

**Detalle de corrida** (drill-down, y destino tras guardar):

```
← Registro
Resultado — 22 jul, 14:06 · Conjunto · por María Gómez
[Abrir reporte de Playwright]  [Abrir carpeta]  [n8n ✓ enviado / Reenviar]

[ Total 30 ] [ Exitosos 26 ] [ Fallidos 4 ] [ Duración 3m 42s ]

● Pruebas fallidas (4)
   ✗ pago rechazado    3.4s ▾   AssertionError: el resultado no coincide…
```

Es el Resultados actual pero con datos reales del registro. "Abrir reporte" queda
deshabilitado si `report=null`.

**Pestaña "Métricas por test"** — seguimiento de errores de los tests
seleccionados (no datos generales):

```
Elige los tests a seguir:   🔍 [buscar…]
   ☑ login.spec.ts:22        ☐ pago.spec.ts:8   ...

 login.spec.ts:22 — "login válido"
   Falló 4 de 10 corridas (40%)      ▁▁█▁▁█▁█▁█  (timeline pasa/falla)
   Último fallo: hoy, 14:06
   Error más frecuente: timeout esperando #submit (3×)
```

Por cada test seleccionado se agrega, leyendo todas las corridas guardadas del
proyecto: **tasa de fallo** (sobre todas las corridas en que aparece),
**línea de tiempo** pasa/falla de las **últimas 10**, **último fallo** y
**error más frecuente** (agrupando los mensajes de `error`).
La lista de tests seleccionables es la unión de los tests vistos en el registro.
Estado vacío: *"Guarda corridas para ver el historial por test."*

La agregación vive en un módulo puro `main/results/metrics.js`
(`testHistory(records, testId)` → `{ runs, failures, failRate, lastFailureAt,
timeline, topError }`) para poder testearla sin Electron. El renderer solo pinta.

### 8. Decisión de guardado tras la corrida — flujo

- **Modal pre-ejecución** ([renderer.js:549](../../electron-app/renderer/renderer.js)):
  se **quita** el toggle *"Generar reporte Word al finalizar"*. Queda solo *Modo
  visual* y *Detener en el primer fallo*. `state.runOptions.generateReport` y su
  paso por `startRun`/`run:start` se eliminan.
- **Al terminar la corrida** (pantalla Ejecución en vivo), aparece un panel de
  decisión con el resumen y tres acciones:
  - **Descartar** → no persiste nada; navega al Registro.
  - **Guardar solo local** → `saveResults(runId, { toN8n:false })` → navega al
    Detalle de la corrida guardada.
  - **Guardar y generar documentación** → `saveResults(runId, { toN8n:true })`;
    si `N8N_NOT_CONFIGURED`, avisa *"Configura la dirección para generar la
    documentación."* y ofrece Guardar solo local.

## Ciclo de vida del reporte efímero

| Momento | Estado de `playwright-report/` |
|---|---|
| Durante la corrida | Playwright lo escribe en el clon |
| El usuario guarda | `ipc.js` lo copia al almacén (`run-<id>/report/`) |
| El usuario descarta | Se deja; lo pisará la corrida siguiente |
| Empieza otra corrida | Playwright lo sobreescribe |

No hace falta un barrido nuevo: el reporte no contiene secretos (a diferencia del
`.env`), así que quedar en el clon hasta la próxima corrida es inocuo.

## Errores

| Código | Situación | Mensaje/efecto |
|---|---|---|
| `N8N_NOT_CONFIGURED` | Sin URL de n8n al **reenviar** documentación (`results:resendN8n`) | "Configura la dirección para generar la documentación." En `results:save` NO se rechaza: la corrida se **guarda local igual** y se devuelve `n8nSkipped:true` para avisar en el detalle. |
| `RUN_EXPIRED` | `results:save` con un `runId` que ya fue pisado | "Esta corrida ya no está disponible para guardar." |
| n8n falla/timeout | El POST no responde ok | Corrida **guardada local** con `n8n.ok=false`; botón **Reenviar** en el registro |
| `report=null` | No existía `playwright-report/` al guardar | Se guarda el JSON; "Abrir reporte" deshabilitado |

## Riesgos

- **Descarte por inacción.** Si el usuario lanza otra corrida sin decidir sobre la
  anterior, el reporte efímero de la anterior se pierde. Es aceptable (equivale a
  descartar) y el panel de decisión lo hace explícito tras cada corrida.
- **Contrato del payload de n8n.** Si el flujo n8n ya existe y espera una forma
  concreta, el payload definido puede no encajar. Mitigación: el payload es el
  registro (datos completos) y `notify-n8n.js` está aislado para ajustarlo sin
  tocar el resto.
- **`shell.openPath` del reporte** depende de que el navegador por defecto abra
  el `index.html` local; en equipos muy restringidos podría no abrir. No bloquea
  el guardado ni las métricas.
- **El renderer no tiene tests automáticos** (los ~99 cubren `main/`). Registro,
  detalle y métricas se verifican a mano.

## Verificación

**Automática** (`node --test`, con dobles, como los ~99 tests actuales):

1. `results-store.test.js` — guardar/listar/leer/borrar; `save` idempotente por
   `id`; `list` ordena por `finishedAt` y omite JSON ilegibles; `remove` borra
   también la carpeta `report/`.
2. `run-tests.test.js` (ampliado) — la promesa resuelve con `tests: [{ id, name,
   status, durationMs, error }]` correctos, incluyendo un fallo con `error`.
3. `metrics.test.js` — `testHistory` calcula tasa de fallo, `lastFailureAt`,
   `timeline` y `topError` (agrupación de mensajes) sobre un conjunto de registros
   de ejemplo; test que solo aparece en algunas corridas.
4. `notify-n8n.test.js` — con `fetchImpl` inyectado: envía el payload esperado a
   la URL; ante respuesta no-ok o excepción devuelve `{ ok:false, error }` sin
   lanzar.
5. `ipc`/derivación de `mode` — 1 test → `individual`; varios/`runAll` →
   `conjunto` (donde ya haya cobertura de ipc, o en una util `deriveMode`).

**Manual** (con la app):

1. Correr **1 test** → el registro lo muestra como *Individual · <nombre>*; correr
   **varios/todos** → *Conjunto · N pruebas*.
2. **Descartar** → nada aparece en el registro.
3. **Guardar solo local** → aparece la corrida; "Abrir reporte" abre el HTML de
   Playwright; "Abrir carpeta" abre la carpeta de la corrida.
4. **Guardar y generar documentación** con URL válida → el POST llega a n8n; sin
   URL → aviso `N8N_NOT_CONFIGURED` y opción de guardar local.
5. **n8n caído** → la corrida queda guardada local; **Reenviar** completa el envío
   cuando n8n vuelve.
6. **Métricas por test** → seleccionar tests refleja su historial real de errores;
   cambia al ajustar la selección; estado vacío sin corridas guardadas.
7. El ítem **Historial** ya no está en el sidebar y el registro lo reemplaza.
