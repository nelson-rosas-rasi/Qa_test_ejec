# Panel del líder — Métricas

**Fecha:** 2026-07-31
**Estado:** diseño aprobado, pendiente de plan de implementación

## Objetivo

Que el QA_LEAD abra una segunda pantalla del panel y vea, sobre las corridas reales
que reportan los analistas desde RunQA, tres cosas: cómo viene la salud general de las
pruebas, cómo se reparte el trabajo entre analistas y proyectos, y cómo evoluciona la
tasa de éxito semana a semana.

Es la continuación de la rebanada 1 ([2026-07-28-panel-lider-corridas-design.md](2026-07-28-panel-lider-corridas-design.md)),
que dejó el listado de corridas y su detalle funcionando de punta a punta. Aquella
rebanada existía para probar la cadena navegador→CORS→JWT→backend; ésta agrega valor
sobre una cadena ya verificada.

**Depende del despliegue de la rebanada 1.** Métricas no se construye hasta que el
backend con `/api/runs` esté publicado y el panel esté sirviendo desde Render. La razón
es de orden, no de código: depurar CORS o el manejo del token con dos pantallas nuevas
en el aire cuesta el doble que con una.

## Contexto: de qué se parte

**Backend** (`~/Escritorio/Proyectos /SpringComuTestQa/ReportRas_Backe`):

- La rama `panel-lider` tiene los dos endpoints de lectura de la rebanada 1
  (`GET /api/runs` y `GET /api/runs/{id}`), 42 tests en verde, lista para mergear a
  `main` con fast-forward.
- `RunSummary` ya expone por corrida `total`, `passed`, `failed`, `skipped`,
  `durationMs`, `startedAt`, `discardedByQa`, más `project` y `user`. **Todo lo que
  Métricas necesita ya está en el modelo**: no hay entidades ni columnas nuevas.
- `RunUserRef` puede venir en `null`. El propio DTO lo documenta: `IngestService`
  guarda la corrida aunque el usuario no exista.

**Frontend** (`~/Escritorio/Proyectos /SpringComuTestQa/Frontend_RasiReport`):

- `theme.js` ya define la paleta y el vocabulario de QA (`Exitosa`, `Con fallos`,
  `En ejecución`, `Sin resultados`, `Validada`), y `ResultsTab` ya está escrito contra
  datos reales con sus estados de carga y error.
- El commit `b411d81` versionó la base visual: la maqueta reetiquetada al dominio de
  ejecuciones y sin la interactividad que no tenía backend detrás. **`ReportsTab.jsx`
  quedó siendo una pantalla de métricas maquetada** —tasa de éxito, ejecuciones
  exitosas y fallidas, barra de distribución, grilla `2fr / 1fr`— alimentada por el
  seed. Métricas es esa pantalla conectada, no una pantalla nueva.
- No hay librerías de gráficos y no se agregan.

**RunQA** (`~/Escritorio/Proyectos /TestQA/Qa_test_ejec/electron-app`):

- `main/results/metrics.js` define el fallo de una prueba como
  `status !== 'passed' && status !== 'skipped'`. El panel usa la misma regla, para que
  la app y el panel no muestren dos números distintos de lo mismo.

## Alcance

**Entra:**

- Un endpoint de lectura agregada, `GET /api/runs/stats`, restringido a `QA_LEAD`.
- La pantalla Métricas en el panel, sobre la maquetación ya existente.
- Un segundo ítem en la navegación del sidebar.

**No entra:**

- **Ranking de pruebas problemáticas** (las que más fallan, las flaky, las más lentas).
  Se descartó explícitamente al definir el alcance. Es la métrica que más agregación
  pide —hay que abrir los resultados de cada corrida, no solo sus totales— y no la
  necesita nadie todavía.
- Filtros por proyecto o por rango de fechas en Métricas. La ventana es fija.
- Exportar las métricas a archivo.

## Decisiones y su porqué

**`passRate` excluye los `skipped` del denominador:** es `passed / (passed + failed)`.
Un test salteado no aprobó ni falló; contarlo como fallo castiga el porcentaje por algo
que no se ejecutó. Además es la definición que ya usa RunQA.

Cuando `passed + failed` da cero —una corrida entera salteada— el `passRate` es `null`,
no cero. Cero significa "todo falló" y sería mentira.

**Las semanas sin corridas se devuelven con `runs: 0` y `passRate: null`.** Si se
omiten, el gráfico une dos puntos separados por un mes con una recta e inventa una
tendencia que nadie midió. Con `null` se dibuja un hueco, que es la verdad.

**Las corridas descartadas por el QA quedan fuera de los cuatro bloques.** RunQA marca
`discardedByQa` cuando el analista descarta una corrida, pero la ingesta la guarda
igual. Una tarde de pruebas a medio armar hundiría la tasa de éxito del equipo.

**Las corridas sin usuario van a un grupo "Sin identificar"**, no se descartan. Si
desaparecieran, la suma de `byUser` no cuadraría con `general` y el primero que lo note
va a desconfiar de todo el tablero.

**`general`, `byUser` y `byProject` cubren toda la historia; solo `trend` se limita a
doce semanas.** Un tablero cuyo "total de corridas" cambia de significado según el
gráfico que tenga al lado es un tablero en el que nadie confía. La ventana es una
propiedad de la tendencia, no del resto.

**La agregación se hace en Java, no en SQL.** El repositorio devuelve una proyección
liviana de todas las corridas no descartadas y un servicio puro arma los cuatro
bloques; la ventana de doce semanas se recorta en memoria al construir `trend`. Con
el volumen del piloto —cientos de corridas— la diferencia de rendimiento es
irrelevante, y a cambio toda la lógica queda cubierta por tests unitarios sin levantar
una base de datos. La alternativa, `date_trunc('week', …)` en SQL nativo, es más rápida
pero ata el código a PostgreSQL y solo se puede probar con una base real.

**Revisar cuando el volumen crezca:** traer todas las corridas a memoria es correcto
con cientos de filas y deja de serlo con decenas de miles. El límite práctico está en
el orden de unas pocas decenas de miles de corridas; llegado ahí, la agregación se baja
a SQL y los tests del servicio puro siguen valiendo como especificación de lo que la
consulta tiene que devolver.

## Contrato

`GET /api/runs/stats` — sin parámetros. Requiere rol `QA_LEAD`.

```json
{
  "success": true,
  "data": {
    "general": {
      "totalRuns": 128,
      "passRate": 0.942,
      "runsWithFailures": 17,
      "avgDurationMs": 184320,
      "passed": 1204,
      "failed": 74,
      "skipped": 31
    },
    "byUser": [
      { "username": "nrosas", "fullName": "Nelson Rosas", "runs": 54, "passRate": 0.96 }
    ],
    "byProject": [
      { "projectId": 1, "name": "ERP Comercial", "runs": 80, "passRate": 0.93 }
    ],
    "trend": [
      { "weekStart": "2026-05-11", "runs": 9, "passRate": 0.91 },
      { "weekStart": "2026-05-18", "runs": 0, "passRate": null }
    ]
  }
}
```

Precisiones:

| Campo | Definición |
|---|---|
| `general.totalRuns` | Corridas no descartadas de toda la historia |
| `general.passRate` | `passed / (passed + failed)` sobre el total acumulado; `null` si el denominador es cero |
| `general.runsWithFailures` | Corridas con `failed > 0` |
| `general.avgDurationMs` | Promedio de `durationMs`, ignorando las corridas que lo tengan en `null`; `null` si ninguna lo trae |
| `general.passed/failed/skipped` | Totales de pruebas, no de corridas. Alimentan la barra de distribución |
| `byUser[].passRate` / `byProject[].passRate` | Misma fórmula que `general.passRate`, sobre las corridas de ese grupo; `null` con denominador cero |
| `byUser[]` del grupo huérfano | `username` y `fullName` ambos en `null`; el frontend muestra "Sin identificar". Aparece solo si hay corridas sin usuario |
| `byUser` / `byProject` | Ordenados por `runs` descendente; a igual cantidad, alfabético, para que el orden sea estable entre llamadas |
| `trend` | Exactamente 12 entradas, de la más vieja a la más nueva, incluida la semana en curso |
| `trend[].weekStart` | Lunes de esa semana, `YYYY-MM-DD`. Se agrupa por `startedAt`, no por `receivedAt`: una corrida reportada tarde pertenece a la semana en que se ejecutó |
| `trend`, corridas sin `startedAt` | `TestRun.startedAt` es anulable. Si falta, la corrida cae en la semana de su `receivedAt`, que siempre existe porque lo pone el servidor. Perderla sería peor: ya cuenta en `general` y el gráfico no cerraría con las tarjetas |

Las fechas se serializan como el resto de la API, en el formato ya fijado por la
rebanada 1 (`LocalDateTime` → `"2026-07-28T10:15:02.12"`). `weekStart` es un
`LocalDate`, sin hora.

**Con la base vacía** —que es el estado de hoy— la respuesta es `200`, no `404`:
`totalRuns: 0`, `passRate` y `avgDurationMs` en `null`, `byUser` y `byProject` como
listas vacías, y `trend` con sus 12 entradas en `runs: 0` / `passRate: null`. La
estructura no cambia según haya datos o no; el frontend decide qué mostrar.

## Backend

| Archivo | Responsabilidad |
|---|---|
| `dto/Dtos.java` (modificar) | Los cinco DTOs de métricas, en su propia sección |
| `repository/TestRunRepository.java` (modificar) | Una consulta que traiga las corridas no descartadas con su proyecto y usuario |
| `service/RunStatsService.java` (crear) | Agregación pura: recibe la lista, devuelve los cuatro bloques |
| `controller/RunController.java` (modificar) | El endpoint y su autorización |

`RunStatsService` va aparte de `RunQueryService` porque no comparten nada: uno traduce
entidades a DTOs de lectura, el otro agrega. Mezclarlos haría crecer un archivo que ya
tiene dos responsabilidades.

La parte agregadora se escribe como **funciones que reciben la lista y devuelven el
bloque**, sin tocar el repositorio. Así los tests le pasan listas armadas a mano y
prueban los casos de borde sin base de datos ni mocks.

## Frontend

| Archivo | Responsabilidad |
|---|---|
| `src/api/runs.js` (modificar) | Agregar `getRunStats()` |
| `src/screens/ReportsTab.jsx` → `MetricsTab.jsx` (`git mv` + reescribir el cuerpo) | La pantalla, sobre la maquetación existente |
| `src/components/Sidebar.jsx` (modificar) | Segundo ítem de navegación |
| `src/screens/MainApp.jsx` (modificar) | Renderizar `tab === 'metrics'` |

**El renombre va con `git mv`** para conservar el historial del archivo: la maquetación
la escribió el usuario y esa autoría no se pierde.

Lo que se conserva de la pantalla actual: la grilla `2fr / 1fr`, el componente
`BigStat`, la barra de distribución y los colores de `theme.js`. Lo que cambia es de
dónde salen los números.

- **Columna derecha (`BigStat`):** tasa de éxito, corridas totales, corridas con
  fallos, duración promedio.
- **Panel izquierdo:** el gráfico de tendencia, en **SVG inline** —doce puntos no
  justifican una dependencia nueva—, con la tasa de éxito por semana y el volumen de
  corridas. Las semanas con `passRate: null` se dibujan como hueco, no como cero.
- **Barra de distribución:** alimentada por `passed`, `failed` y `skipped`.
- **Dos tablas nuevas:** por analista y por proyecto, con el mismo patrón de grilla
  (`gridTemplateColumns`) que usa `ResultsTab`, para que las pantallas se lean como una
  familia.

**Estados**, copiando los de `ResultsTab`: carga con el aviso de que la primera
consulta puede tardar dos minutos mientras el backend despierta; error con botón de
reintentar; y **vacío**, que hoy es el caso real —no hay ninguna corrida ingerida en
la base— y tiene que decir con palabras que todavía no llegaron corridas, en vez de
mostrar ceros que se leen como sistema roto.

## Testing

**Backend.** El servicio agregador es una clase pura, así que los casos de borde se
prueban con JUnit sin base de datos:

- Los `skipped` no entran al denominador de `passRate`.
- Una corrida enteramente salteada da `passRate: null`, no cero.
- Una semana sin corridas aparece con `runs: 0` y `passRate: null`.
- Las corridas descartadas no suman en ninguno de los cuatro bloques.
- Las corridas sin usuario caen en "Sin identificar" y la suma de `byUser` cuadra con
  `general.totalRuns`.
- `trend` siempre trae 12 entradas, ordenadas de la más vieja a la más nueva.

Aparte, un test de MockMvc sobre el endpoint: `QA_LEAD` recibe 200, `QA_ANALYST` 403 y
un anónimo 401.

**Frontend.** No hay infraestructura de tests y no se agrega en esta rebanada, igual
que en la anterior. La verificación es manual contra el backend real. **Es una decisión
consciente, no un olvido:** montar Vitest y una capa de mocks de `fetch` cuesta más que
esta pantalla, y la rebanada anterior ya fijó ese criterio.

## Riesgos

**La base está vacía.** Verificado contra Neon: no hay corridas ingeridas. Métricas se
va a ver vacía hasta que alguien corra pruebas desde RunQA y las guarde. La verificación
de punta a punta exige generar al menos una corrida real primero; si no, no se distingue
"funciona y no hay datos" de "no funciona".

**El arranque en frío del backend.** El plan gratuito de Render duerme el servicio: la
primera consulta del día tarda unos dos minutos. Métricas hace una sola llamada, así
que hereda el mismo problema que el listado y la misma solución —decirlo con palabras
en el estado de carga.

**Doce semanas es una ventana arbitraria.** Se eligió porque muestra un trimestre sin
volver el gráfico ilegible. Si al usarlo resulta corta o larga, cambiarla es tocar una
constante; no vale la pena hacerla configurable antes de saberlo.
