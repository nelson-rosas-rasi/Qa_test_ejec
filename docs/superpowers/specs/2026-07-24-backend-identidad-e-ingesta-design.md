# Conexión con el backend: identidad e ingesta de corridas — Diseño

Fecha: 2026-07-24
Estado: aprobado
Alcance: **dos repositorios**
- RunQA (Electron): `Escritorio/Proyectos /TestQA/Qa_test_ejec/electron-app`
- qa-reports (Spring Boot 3.2.5 / Java 17 / PostgreSQL): `Escritorio/Proyectos /SpringComuTestQa/ReportRas_Backe`

## Contexto

**RunQA** es una app Electron que corre pruebas Playwright. Hoy **todo es local a cada
escritorio**: las corridas se guardan en `userData/results/<proyecto>/`, las métricas
(`main/results/metrics.js`) se calculan solo sobre los records locales, y las grabaciones
se suben por git a una rama del repo de pruebas. La única salida a la red es un webhook
opcional de n8n que recibe el `record` completo.

Consecuencia: **nadie ve el conjunto**. Cada QA conoce su propia historia; el responsable
de infraestructura no tiene forma de saber qué se está probando ni cómo va.

**qa-reports** es el backend existente (ROYALNET). Ya tiene:

- Auth JWT (`AuthController`, `JwtAuthFilter`) y `User` con roles `QA_LEAD` / `QA_ANALYST` / `VIEWER`.
- `QaModule`: `name`, `description`, `projectType`, `status`
  (`NOT_STARTED → IN_PROGRESS → DONE / IN_REPAIR → VERIFIED`), `coverage` (0-100), `assignee` (String), `driveFolderId`.
- `ModuleFile`: evidencia en Google Drive (`driveFileId`, `driveViewUrl`).
- Endpoints: CRUD de módulos, `POST /api/modules/{id}/files`, `PATCH /{id}/status`, `GET /stats`.

**No tiene absolutamente nada sobre corridas**: no existe entidad de ejecución, ni
resultados por test, ni historial. El `coverage` se escribe a mano y se fuerza a 100 al
marcar `DONE` — no se mide. Y RunQA no le habla en absoluto.

### Este spec es una pieza de un roadmap mayor

| Pieza | Estado |
|---|---|
| A. Onboarding, instalador y dependencias (incl. navegadores de Playwright) | pendiente |
| **B. Conexión e identidad** | **este spec** |
| **C. Ingesta de corridas y sincronización de módulos** | **este spec** |
| D. Métricas y coverage medido | pendiente |
| E. Grabaciones: inventario, asignación y control | pendiente |
| F. Evidencia (PDF) a Drive y resolución del solape con n8n | pendiente |

## Alcance

**Dentro:**

1. **Identidad y sesión (B):** el QA inicia sesión en RunQA contra qa-reports; la sesión
   se guarda cifrada y la app sigue funcionando sin red.
2. **Ingesta (C):** toda corrida terminada viaja al backend; el backend la persiste y
   atribuye cada resultado a su módulo.
3. **Sincronización de módulos:** el catálogo de módulos del backend se alimenta del
   árbol de carpetas del repo.

**Fuera (YAGNI / piezas posteriores):**

- Instalador, asistente de primer arranque y descarga de dependencias (pieza A).
- Pantallas de asignación y control de grabaciones (pieza E).
- Subida de PDF/evidencia a Drive (pieza F) y decidir el futuro de n8n.
- Frontend web para infraestructura (consume la API; ya existe un `reporte_frontend.html`).
- Agregaciones y dashboards (pieza D). Este spec **persiste** los datos; explotarlos es D.

## Decisiones tomadas

1. **Un módulo es un área funcional, y su identidad viene del repo, no del backend.**
   Las carpetas ya existen en GitHub (`test/atenciones/…`), así que el repo es la fuente
   de verdad. El backend **sincroniza** el catálogo; nadie crea módulos a mano. El lead
   solo administra `assignee` y `status` encima.
2. **El mapeo test → módulo es la primera carpeta del path del spec.** Ya lo hace
   `main/playwright/build-tree.js:26-35` para pintar el árbol. Un spec en la **raíz**
   (sin carpeta) es una **grabación sin refinar** y no pertenece a ningún módulo.
3. **La correlación entre escritorios es por `repoUrl`, nunca por el `projectId` local.**
   El id local sale de `uniqueProjectId(nombre)` (un slug con sufijos `-2`, `-3`), así que
   dos QAs pueden tener ids distintos para el mismo repo, o el mismo id para repos
   distintos. Usarlo como clave global mezclaría y separaría datos mal.
4. **`ProjectType` (enum `ERP`/`MEDICAL`) se reemplaza por una tabla `Project`.** Cada repo
   es una vista independiente, sin relación con las demás; con un enum, añadir una tercera
   vista es cambio de código y migración, y además no hay dónde guardar la `repoUrl`.
5. **Login obligatorio la primera vez; después funciona offline** con la sesión guardada.
6. **Las altas de usuarios las hace el `QA_LEAD`.** Hoy `/api/auth/**` está `permitAll()`
   (`SecurityConfig:46`), o sea que cualquiera que alcance el servidor puede registrarse:
   hay que cerrar `register` y dejar abierto solo `login`.
7. **Se envían todas las corridas, automáticamente al terminar.** El panel
   *Descartar / Guardar local / Guardar y documentar* sigue existiendo pero solo decide lo
   local; viaja una bandera con esa decisión. Si solo se enviara lo que el QA guarda, las
   métricas quedarían sesgadas (nadie guarda sus peores corridas).
8. **Cola durable en disco con reintentos.** El envío nunca bloquea al QA ni le muestra
   errores de red; si el servidor está caído, la corrida no se pierde.

## Arquitectura — backend (qa-reports)

### Entidades

**`Project`** *(nueva; reemplaza el enum `ProjectType`)*

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Long | PK |
| `name` | String(150) | Nombre legible (ej. "ERP", "Medical") |
| `repoUrl` | String(500) | **único**; clave de correlación entre escritorios |
| `active` | boolean | |
| `createdAt` | LocalDateTime | |

Migración: ERP y MEDICAL quedan como las dos primeras filas. `QaModule.projectType` pasa a
`@ManyToOne Project project`.

**`QaModule`** *(modificada)* — conserva `name`, `description`, `status`, `coverage`,
`assignee`, `driveFolderId`, `files`. Cambia `projectType` por `project`. Se añade
restricción **única `(project, name)`**: el nombre es el de la carpeta y no se repite
dentro de un repo.

**`TestRun`** *(nueva)*

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Long | PK |
| `runId` | String(100) | El id que genera RunQA. **Único junto con `project`** → idempotencia |
| `project` | Project | Resuelto por `repoUrl` |
| `user` | User | El QA, tomado del JWT (no del payload) |
| `startedAt` / `finishedAt` | LocalDateTime | Reloj del escritorio |
| `receivedAt` | LocalDateTime | Reloj del servidor (los escritorios pueden ir desfasados) |
| `mode` | String(20) | `individual` \| `conjunto` |
| `total` / `passed` / `failed` / `skipped` | Integer | |
| `durationMs` | Long | |
| `discardedByQa` | boolean | El QA eligió "Descartar" en su equipo |

**`TestResult`** *(nueva)*

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Long | PK |
| `run` | TestRun | |
| `module` | QaModule | **nullable** — `null` = spec en la raíz = sin refinar |
| `testId` | String(500) | `atenciones/cobros.spec.ts:12` |
| `specFile` | String(400) | `atenciones/cobros.spec.ts` |
| `name` | String(500) | Título del test |
| `status` | String(20) | `passed` \| `failed` \| `skipped` \| … |
| `durationMs` | Long | |
| `error` | text | nullable |
| `flaky` | boolean | Derivado de `retry > 0` |

### Endpoints nuevos

**`POST /api/sync/modules`** — sincroniza el catálogo desde el repo.

```json
{ "repoUrl": "https://github.com/…/pruebas.git",
  "projectName": "ERP",
  "modules": ["atenciones", "facturacion"] }
```

Hace *upsert* del `Project` por `repoUrl` y de cada `QaModule` por `(project, name)`.
**No borra** módulos que dejen de aparecer (una carpeta puede desaparecer por un checkout
parcial; borrar arrastraría `assignee`/`status`/historial). Roles: `QA_LEAD`, `QA_ANALYST`.

**`POST /api/runs`** — ingesta de una corrida.

Cuerpo: el `record` que RunQA ya construye (`id` → se envía como `runId`, tiempos, `mode`,
`summary`, `tests[]` con `{ id, name, status, durationMs, error, retry }`), **enriquecido por
el cliente con dos campos que hoy no existen en el record**:

- **`repoUrl`** — el record actual solo trae `projectId`/`projectName` (locales), y el
  `projectId` es justamente el que no sirve como clave global. El cliente lo toma de
  `store.getProject(projectId).repoUrl`.
- **`discardedByQa`** — la decisión del panel local.

Los campos `profileId`/`profileName` (el perfil local del QA) viajan como información
descriptiva, pero **el usuario autoritativo es el del JWT**.

Comportamiento:
1. Resuelve `Project` por `repoUrl`; si no existe, **lo crea** (el repo manda).
2. El QA sale del **JWT**, nunca del cuerpo (si no, un cliente podría reportar por otro).
3. Si ya existe `(project, runId)` → **204, no duplica** (idempotencia ante reenvíos).
4. Por cada test: `specFile` = parte antes de `:`; carpeta = primer segmento; si hay
   carpeta, se resuelve/crea el `QaModule`; si no, `module = null`.

Roles: `QA_LEAD`, `QA_ANALYST`.

### Seguridad

`SecurityConfig`: `/api/auth/login` queda `permitAll()`; **`/api/auth/register` pasa a
`hasRole("QA_LEAD")`**. El resto sin cambios.

### `coverage` calculado

`QaModule.coverage` deja de escribirse a mano y pasa a calcularse como:

> **porcentaje de pruebas del módulo cuyo último resultado conocido fue `passed`.**

**Interpretación explícita:** esto mide **salud de las pruebas**, no "porcentaje de flujos
del negocio automatizados". Lo segundo necesitaría un denominador declarado por una persona
(cuántos flujos *debería* tener el módulo) que el repo no conoce; queda fuera de alcance. Si
lo que se quiere es esa otra métrica, hay que añadir ese denominador y este spec cambia.

Se deja de forzar `coverage = 100` al pasar a `DONE`/`VERIFIED`.

## Arquitectura — RunQA (Electron)

Se mantiene el patrón del repo: módulos pequeños y testeables, handlers de IPC delgados.

- **`main/server/client.js`** *(nuevo)* — cliente HTTP: `login`, `postRun`, `syncModules`.
  `fetchImpl` inyectable (igual que `notify-n8n.js`). No lanza por errores de red:
  devuelve resultado.
- **`main/server/session.js`** *(nuevo)* — guarda/lee el JWT y los datos del usuario con
  `safeStorage` (mismo mecanismo que la cuenta de GitHub y los perfiles). Expone
  `save/load/clear` y si la sesión está expirada.
- **`main/server/queue.js`** *(nuevo)* — cola durable en disco bajo
  `userData/outbox/<runId>.json`. `enqueue`, `list`, `remove`. Sin dependencias de Electron
  (testeable con directorio temporal), igual que `results/store.js`.
- **`main/server/sender.js`** *(nuevo)* — worker: drena la cola en segundo plano con
  reintentos espaciados; marca enviado borrando de la cola. Se dispara al terminar una
  corrida, al recuperar la sesión y al arrancar la app.
- **`main/ipc.js`** — handlers `auth:login`, `auth:logout`, `auth:status`; encolar el envío
  al final de `run:start`; llamar a `syncModules` tras obtener el árbol de pruebas.
- **`preload.js`** — wrappers correspondientes.
- **`renderer/renderer.js`** — pantalla de login (bloquea el uso si nunca se inició sesión)
  e indicador de estado de envío (pendientes en cola).

**URL del servidor:** ajuste **global** (no por proyecto, a diferencia de la URL de n8n),
guardado con `store.setSetting('serverUrl', …)`, con un valor por defecto compilado y
editable en la pantalla Configuración.

## Flujos

- **Primer arranque:** login → JWT + usuario guardados cifrados → la app queda usable. Si
  el QA marca "permanecer logeado" (por defecto sí), no se le vuelve a pedir.
- **Corrida termina:** se arma el `record` (ya existe) → **se encola siempre** → el worker
  intenta enviarlo. En paralelo, el panel local decide guardar/descartar/documentar y esa
  decisión viaja como `discardedByQa`.
- **Sin red o servidor caído:** la corrida se queda en la cola; el QA no se entera más allá
  de un contador de pendientes. Al volver la red, se drena sola.
- **Apertura de un proyecto:** tras leer el árbol de pruebas, se envía `syncModules` con las
  carpetas encontradas.

## Errores y casos borde

- **Reenvío duplicado** (la app muere después de enviar y antes de borrar de la cola): el
  backend responde 204 por la unicidad `(project, runId)`; el cliente borra igual.
- **Token expirado sin red:** se sigue encolando; se pide login cuando vuelva la red. No se
  borra la cola nunca por un fallo de auth.
- **Repo no registrado:** el backend crea el `Project` por `repoUrl` (el repo es la fuente
  de verdad), con `name` = el que envía el cliente.
- **Test en la raíz:** `module = null`; alimenta la métrica "grabaciones sin refinar".
- **Carpeta nueva en el repo:** aparece como módulo en el siguiente `syncModules` o en la
  primera corrida que la incluya.
- **Reloj desfasado del escritorio:** se persisten `finishedAt` (equipo) y `receivedAt`
  (servidor); las agregaciones de la pieza D usarán `receivedAt` para ordenar.
- **Cola creciendo sin límite** (servidor caído mucho tiempo): se acota por número de
  archivos; al superar el tope se descartan los más antiguos y se registra el descarte.

## Testing

**RunQA** (`node:test`, directorios temporales y fakes inyectados, como el resto del repo):

- `client.js`: login OK / credenciales malas / servidor caído (con `fetchImpl` falso).
- `session.js`: guardar y recuperar; sesión ausente; `safeStorage` no disponible.
- `queue.js`: encolar y listar; borrar; sobrevive a recrear el store; tope de tamaño.
- Atribución test → módulo: `atenciones/x.spec.ts:12` → `atenciones`; `x.spec.ts:3` → `null`.

**Backend** (`spring-boot-starter-test`, ya en el `pom.xml`):

- `POST /api/runs`: crea run y resultados; atribuye módulos por carpeta; raíz → `module` null;
  reenvío del mismo `runId` no duplica; el QA sale del JWT y no del cuerpo.
- `POST /api/sync/modules`: crea el `Project` por `repoUrl`; upsert idempotente; no borra
  módulos ausentes.
- `SecurityConfig`: `register` rechaza a quien no sea `QA_LEAD`; `login` sigue abierto.
- `coverage` calculado sobre resultados conocidos.

**Manual:** correr una prueba con el servidor caído y verificar que la app no se traba y que
la corrida se envía sola al levantarlo.

## Notas de integración

- El repo de **RunQA tiene mucho WIP sin commitear** sobre `main` (features del 23 y 24 de
  julio). Igual que en el plan anterior, conviene trabajar sobre el working tree y verificar
  con la suite (`npm test`, 197/197 en verde) más snapshots, en vez de `git diff`.
- El repo del **backend está limpio** (4 commits) y ahí sí se puede commitear normal.
- El backend usa `ddl-auto: update`, así que las entidades nuevas se crean solas; el cambio
  de `projectType` (enum) a `project` (FK) **sí necesita migración de datos** si ya hay
  módulos guardados.
