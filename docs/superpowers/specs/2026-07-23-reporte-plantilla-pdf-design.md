# Reporte local con plantilla (PDF) — Diseño

Fecha: 2026-07-23
Estado: en revisión (working tree, sin commitear)
Proyecto: RunQA (`Qa_test_ejec/electron-app`)

## Contexto

Hoy, al guardar una corrida, el "reporte local" es una **copia del HTML de Playwright**
(`repoPath/playwright-report` → results store) hecha en `results:save`
(`main/ipc.js`). El equipo QA de RASI usa una **plantilla estándar** de reporte E2E
(documento con secciones fijas y campos `{{TOKEN}}`) que hoy se llena a mano. Este spec
automatiza eso: al guardar local, RunQA **rellena la plantilla con los datos de la
corrida + el `.env` del perfil y genera un PDF**.

Esto además **corrige el bug de "el reporte es del anterior"** para el reporte local:
el PDF se genera a partir de los datos de *esa* corrida (`record`), no copiando el
directorio `playwright-report` (cuya copia podía quedar desfasada).

Plantilla de referencia: `FormatoReporteE2EQARASI` (tokens) + ejemplo lleno
`ReporteE2E_20260714_1155`. Notas de mapeo en el scratchpad de la sesión.

## Alcance

Generar, al **guardar una corrida**, un **PDF** basado en la plantilla RASI, con los
`{{tokens}}` reemplazados por datos reales. El PDF pasa a ser el **reporte local
principal**; el HTML de Playwright queda como reporte secundario.

### Fuera de alcance (YAGNI)

- Editor de plantillas en la UI (la plantilla va embebida en la app).
- Capturar la ruta exacta del screenshot por test (hoy no se captura; se apunta a la
  carpeta `test-results`).
- Cambiar el flujo de n8n (sigue posteando el `record` como hoy; el PDF es local e
  independiente).
- Campos `AMBIENTE`, `URL_SERVIDOR`, `VERSION_ERP`: por ahora **en blanco** (decisión
  del usuario). El diseño deja el punto de extensión para mapearlos a claves `.env`
  cuando se definan.

## Decisiones acordadas

- **Motor PDF:** `webContents.printToPDF()` de Electron en una `BrowserWindow` oculta.
  Sin dependencias nuevas (el proyecto solo depende de `electron-updater`).
- **Cuándo se genera:** en `results:save`, tanto para "Guardar solo local" como para
  "Guardar y generar documentación". n8n no cambia.
- **Logo:** un único logo RASI, archivo bundleado en `main/results/assets/rasi-logo.png`,
  incrustado como data URI. Si el archivo no existe, encabezado de texto de respaldo.
- **Campos en blanco:** `AMBIENTE`, `URL_SERVIDOR`, `VERSION_ERP` se renderizan vacíos.
- **Observaciones:** texto fijo "Sin observaciones" (sin campo de entrada por ahora).

## Mapeo de tokens → datos

Fuente `record` (la corrida, ya en `lastRun`/results store) y `profileValues`
(`profileStore.load` del perfil de la corrida).

**1. Información general**
- `FECHA` = fecha de `record.finishedAt` (YYYY-MM-DD)
- `HORA` = hora de `record.finishedAt` (HH:mm)
- `EJECUTADO_POR` = `profileValues.QA_NOMBRE` (o `record.profileName`)
- `PERFIL` = `record.profileId` (id del perfil, ej. "Kvergel_vid")
- `AMBIENTE` = "" (en blanco)
- `URL_SERVIDOR` = "" (en blanco)
- `VERSION_ERP` = "" (en blanco)

**2. Resumen de resultados** (de `record.summary` / `record.tests`)
- `TOTAL_TESTS` = `summary.total`
- `PASSED` = `summary.passed`
- `FAILED` = `summary.failed`
- `SKIPPED` = `summary.skipped`
- `FLAKY` = # de tests con `status==='passed' && retry>0` (requiere persistir `retry`)
- `DURACION` = `record.durationMs` formateado (ej. "2.7m" si ≥60s, si no "45s")
- `RESULTADO_GENERAL` = `FAILED>0 ? "CON FALLOS" : "TODOS OK"`

**3. Resultados por módulo** — `TABLA_MODULOS`
- Módulo = del `id` del test: quita `.spec.ts:line` → ej. `atencion/flujo-completo-infectologia`.
- Por módulo: `"<mod>: N tests, X OK, Y fallaron, Z flaky - OK|FALLO"`.
- Línea final: `"TOTAL: N tests, X OK, Y fallaron, Z flaky"`.

**4. Detalle de tests ejecutados** — `DETALLE_TESTS`
- Una línea por test: `"[OK|FALLO|SKIP|FLAKY]  > <id> > <name> (<durationMs>ms)"`.

**5. Detalle de tests fallidos** — `DETALLE_FALLOS`
- Por cada test fallido (status distinto de passed/skipped): bloque con
  `Test`, `Módulo`, `Archivo` (`tests/<relPath>.spec.ts`), `Error` (`test.error`),
  `Tipo` (heurística: contiene "Timeout"→"Timeout", si no "Error"),
  `Screenshot` ("Ver carpeta test-results/"), `Consistente` ("No verificado"),
  `Causa probable` (heurística: Timeout→"Servidor lento / Timing", si no "Por revisar").
- Si no hay fallos: "Sin fallos".

**6. Tests inestables (flaky)** — `DETALLE_FLAKY`
- Lista de los flaky (status passed, retry>0) o "Sin tests inestables".

**7. Observaciones** — `OBSERVACIONES` = "Sin observaciones".

**8. Acciones de seguimiento** — `ACCIONES`
- Si `FAILED>0`: "- Reportar fallos al desarrollador" + "- Adjuntar evidencia
  (screenshots, trace) al ticket/reporte".
- Si todo OK: "- Ejecución exitosa, sin acciones pendientes".

**9. Firma**
- `FIRMA_NOMBRE` = `profileValues.QA_NOMBRE`
- `FIRMA_CARGO` = `profileValues.QA_CARGO`
- `FIRMA_FECHA` = fecha de `record.finishedAt`

## Arquitectura y módulos

Patrón del repo: lógica pura testeable en módulos; IPC/Electron delgado.

### Backend (`main/results/`)

- **`report-template.html`** *(nuevo)* — plantilla HTML autocontenida (CSS inline,
  paleta RASI: títulos #1f4e79, cabeceras #2e75b6 texto blanco, filas #f2f2f2/#f9f9f9,
  Arial) con los `{{TOKENS}}` de arriba y un `{{LOGO}}` (data URI o vacío) en el header.
- **`report-data.js`** *(nuevo, puro y testeable)* — `buildReportTokens(record, profileValues)`
  → objeto `{ FECHA, HORA, ..., FIRMA_FECHA }` (strings ya formateados). Incluye helpers
  internos: `formatDuration(ms)`, `moduleOf(id)`, `groupByModule(tests)`, `isFlaky(t)`,
  `errorType(msg)`, `probableCause(msg)`, `buildDetalleTests`, `buildDetalleFallos`,
  `buildAcciones`. Escapa HTML de los valores dinámicos que van al template.
- **`report-html.js`** *(nuevo, puro)* — `fillTemplate(templateHtml, tokens)` (reemplaza
  `{{TOKEN}}` por su valor; tokens ausentes → ""), y `logoDataUri(readFileSync?)` que
  lee `assets/rasi-logo.png` y lo vuelve `data:image/png;base64,...` (o "" si falta).
- **`report-pdf.js`** *(nuevo, thin, usa Electron)* — `renderPdf(html, outPath, { BrowserWindow })`:
  carga el HTML en una ventana oculta y hace `printToPDF` → escribe el PDF.
- **`main/playwright/run-tests.js`** *(modificar)* — persistir `retry` en cada detalle
  (`details.set(... , { ..., retry: record.retry })`) para poder calcular flaky.
- **`main/ipc.js`** *(modificar `results:save`)* — tras armar `record`, generar el PDF:
  `tokens = buildReportTokens(record, profileValues)`, `html = fillTemplate(template, { ...tokens, LOGO: logoDataUri() })`,
  `renderPdf(html, resultsStore.reportPdf(projectId, runId))`, y sellar
  `record.report = { kind:'template-pdf', path: '<runId>/reporte.pdf' }` (además de,
  opcional, conservar la copia HTML de Playwright como secundaria).
- **`main/results/store.js`** *(modificar)* — añadir `reportPdf(projectId, runId)` =
  `<runId>/reporte.pdf` dentro del run dir.

### Renderer

- **`renderResultDetail`** — el botón "Abrir reporte" abre el **PDF** (vía
  `results:openReport`, que apunta al PDF). Si además hay HTML de Playwright, un botón
  secundario "Reporte visual (Playwright)".

### Assets

- `main/results/assets/rasi-logo.png` — el usuario coloca el PNG del logo RASI.
  (Paso manual en el plan; el código degrada a header de texto si falta.)

## Errores y casos borde

- Sin logo → header de texto, el PDF se genera igual.
- `printToPDF` falla → `record.report = null` y se guarda la corrida igual (no se pierde
  el registro); se avisa en el detalle.
- Corrida sin tests / todos skipped → tokens con 0 y "Sin fallos"/"Sin tests inestables".
- Valores dinámicos escapados para no romper el HTML de la plantilla.

## Testing

- **Unit (`node:test`, estilo del repo):** `test/report-data.test.js` cubre
  `buildReportTokens` con un `record` de ejemplo (mezcla passed/failed/skipped/flaky):
  verifica resumen, agrupación por módulo, flaky, `RESULTADO_GENERAL`, `DETALLE_FALLOS`
  ("Sin fallos" cuando aplica), `ACCIONES`, y formato de duración. `test/report-html.test.js`
  cubre `fillTemplate` (reemplazo de tokens, token ausente → "").
- **Manual smoke (`npm start`, sin display en el entorno del agente):** correr una prueba,
  Guardar local → abrir el PDF y verificar que refleja *esa* corrida y respeta la plantilla.

## Notas de integración

- No commitear (working tree). Revisar con snapshots (`diff -u`), no `git diff`.
- El PDF resuelve el reporte local del run actual; si se quiere seguir usando el HTML de
  Playwright como secundario, su copia queda como está (y su posible desfase se investiga
  aparte).
- Pendientes fuera de este spec: alertas emergentes (#3) y botón Detener (#4), acordados
  por separado.
