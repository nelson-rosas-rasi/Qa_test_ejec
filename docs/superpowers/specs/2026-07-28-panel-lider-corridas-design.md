# Panel del líder — rebanada 1: listado de corridas

**Fecha:** 2026-07-28
**Estado:** diseño aprobado, pendiente de plan de implementación

## Objetivo

Que el QA_LEAD entre a una URL con su usuario real y vea las corridas que reportan
los analistas desde RunQA, pudiendo abrir cualquiera para revisar prueba por prueba
con su error.

Es la primera de cuatro rebanadas. El objetivo completo —que el líder vea reportes,
métricas y ejecuciones, y haga seguimiento notificando a los QA— se construye en este
orden:

1. **Listado de corridas** (este spec): una pantalla, de punta a punta y desplegada.
2. Estado por módulo.
3. Cumplimiento semanal + notificaciones (son la misma pieza: el botón de notificar
   sale de la tabla de atrasados).
4. Tendencia en el tiempo.

**Por qué esta es la primera:** ninguna parte de la cadena navegador→backend está
probada. El frontend nunca hizo una llamada HTTP, así que el CORS, el manejo del JWT
en el navegador y el despliegue del estático están sin verificar. Esos tres riesgos
muerden igual con una pantalla que con cinco; conviene que muerdan ya.

## Contexto: de qué se parte

**Backend** (`~/Escritorio/Proyectos /SpringComuTestQa/ReportRas_Backe`, Spring Boot
3.2.5 / Java 17, desplegado en <https://reportras-backe.onrender.com>):

- No existe **ningún** endpoint de lectura de corridas. `IngestController` expone solo
  `POST /api/runs` y `POST /api/sync/modules`. Las corridas y sus resultados existen
  únicamente en la base.
- Lo único consultable es de módulos: `GET /api/modules`, `/api/modules/{id}` y
  `/api/modules/stats`.
- El CORS **ya es configurable** por propiedad: `SecurityConfig` lee
  `cors.allowed-origins`. Habilitar el panel es una variable de entorno, no código.

**Frontend** (`~/Escritorio/Proyectos /SpringComuTestQa/Frontend_RasiReport`, React 18
+ Vite, 802 líneas):

- Las pantallas están diseñadas (Login, Módulos, Reportes, Resultados, Archivos, con
  sidebar, filtros y tarjetas) pero **no hacen una sola llamada HTTP**: ni `fetch`, ni
  `axios`, ni una referencia a `/api/`. Es una maqueta sobre `src/data/seed.js`.
- El modelo del seed **no coincide con el del backend**: está armado sobre dos
  proyectos fijos (`erp` / `med`) con módulos hardcodeados y campos que no existen en
  la base (`code`, `cases`, `sprint`, `files`). El backend identifica proyectos por
  `repoUrl` y deriva los módulos de carpetas del repo. Conectar no es cambiar el
  origen de los datos: hay que reacomodar el contexto.

## Alcance

**Entra:**

- Dos endpoints de lectura en Spring, restringidos a `QA_LEAD`.
- Capa HTTP en el frontend, login real y pantalla de corridas con detalle.
- El panel desplegado como Static Site en Render, hablando con el backend real.

**No entra:** estado por módulo, cumplimiento semanal, notificaciones, tendencia,
archivos/grabaciones (dependen de Drive, fuera del piloto).

**Las pestañas todavía no conectadas se ocultan**, no quedan con el seed. Un panel que
mezcla datos reales con inventados es peor que uno chico: nadie sabe cuál mirar, y
tarde o temprano alguien decide algo mirando un número falso.

## Arquitectura

Tres repositorios, dos que se tocan en esta rebanada:

```
Frontend_RasiReport (React)          ReportRas_Backe (Spring)         Neon
   panel del líder      ── HTTPS ──►   GET /api/runs         ── JDBC ──► test_runs
   Static Site / Render                GET /api/runs/{id}                test_results
                                              ▲
                                              │ POST /api/runs
                                     RunQA (Electron) — sin cambios
```

RunQA no se toca. El contrato entre frontend y backend se fija en este documento
(sección "Contrato"), lo que permite construir las dos mitades en paralelo.

## Backend

### Endpoints

```
GET /api/runs?projectId={id}&page=0&size=20   listado paginado
GET /api/runs/{id}                            una corrida con sus resultados
```

`projectId` es opcional: sin él, todas las corridas de todos los proyectos.

`page` por defecto `0` y `size` por defecto `20`, **con tope de 100**: sin tope, un
`size=100000` obliga al backend a materializar la tabla entera en memoria, y los 512 MB
de Render no lo toleran. Un `size` mayor al tope se recorta al tope en silencio.

Ambos con `@PreAuthorize("hasRole('QA_LEAD')")`, siguiendo el patrón que ya usa
`POST /api/auth/register`. Los analistas conservan permiso solo de ingesta.

### Decisiones y su porqué

**El listado no trae los resultados individuales.** Con 20 corridas de 30 pruebas
serían 600 filas por página y un N+1 garantizado. El detalle los trae solo al abrir
una corrida.

**Se ordena por `received_at` descendente, no por `finished_at`.** La cola offline de
RunQA puede entregar hoy una corrida de ayer; ordenar por cuándo se ejecutó la
enterraría en medio de la lista y el líder no vería lo que acaba de llegar.
`finishedAt` se muestra igual, pero el orden es el de llegada.

**Paginación real desde el primer día**, con `Page` de Spring Data en el repositorio.
Con cinco analistas ejecutando semanalmente esto supera las mil filas en meses, y
agregar paginación después obliga a rehacer la pantalla.

**No se serializa el `Page` de Spring directamente.** Su JSON incluye estructuras
internas (`pageable`, `sort`) que cambian entre versiones y que el frontend no
necesita. Se devuelve un DTO propio con los cuatro campos que importan.

**`user` puede venir `null`.** `IngestService` resuelve el usuario con
`orElse(null)`: si el username del token no existe en la tabla, la corrida se guarda
igual, sin dueño. El frontend tiene que contemplarlo y mostrar "—", no romperse.

### Contrato

Todas las respuestas van envueltas en el `ApiResponse` que ya usa el backend:
`{"success": true, "message": null, "data": ...}`. Las fechas son ISO-8601 sin zona
horaria (las columnas son `timestamp without time zone` y Spring Boot serializa
`LocalDateTime` en ISO por defecto).

**`GET /api/runs?page=0&size=20`**

```json
{
  "success": true,
  "message": null,
  "data": {
    "content": [
      {
        "id": 42,
        "runId": "run-2026-07-28-1015",
        "project": { "id": 1, "name": "ERP Comercial", "repoUrl": "https://github.com/rasi/rasierp-e2e.git" },
        "user": { "username": "nrosas", "fullName": "Nelson Rosas" },
        "mode": "conjunto",
        "startedAt": "2026-07-28T10:15:02.120",
        "finishedAt": "2026-07-28T10:15:44.870",
        "receivedAt": "2026-07-28T10:15:45.010",
        "durationMs": 42750,
        "total": 30, "passed": 27, "failed": 2, "skipped": 1,
        "discardedByQa": false
      }
    ],
    "page": 0,
    "size": 20,
    "totalElements": 137,
    "totalPages": 7
  }
}
```

**`GET /api/runs/42`** — los mismos campos de la corrida, más `results`:

```json
{
  "success": true,
  "message": null,
  "data": {
    "id": 42,
    "runId": "run-2026-07-28-1015",
    "project": { "id": 1, "name": "ERP Comercial", "repoUrl": "https://github.com/rasi/rasierp-e2e.git" },
    "user": { "username": "nrosas", "fullName": "Nelson Rosas" },
    "mode": "conjunto",
    "startedAt": "2026-07-28T10:15:02.120",
    "finishedAt": "2026-07-28T10:15:44.870",
    "receivedAt": "2026-07-28T10:15:45.010",
    "durationMs": 42750,
    "total": 30, "passed": 27, "failed": 2, "skipped": 1,
    "discardedByQa": false,
    "results": [
      {
        "id": 501,
        "testId": "test/atenciones/login.spec.ts:12",
        "name": "ingresa con credenciales válidas",
        "specFile": "test/atenciones/login.spec.ts",
        "module": { "id": 3, "name": "atenciones" },
        "status": "passed",
        "durationMs": 2100,
        "flaky": false,
        "error": null
      },
      {
        "id": 502,
        "testId": "test/facturacion/emitir.spec.ts:44",
        "name": "emite factura electrónica",
        "specFile": "test/facturacion/emitir.spec.ts",
        "module": { "id": 5, "name": "facturacion" },
        "status": "failed",
        "durationMs": 15300,
        "flaky": false,
        "error": "TimeoutError: locator.click: Timeout 15000ms exceeded."
      }
    ]
  }
}
```

`module` puede ser `null`: un spec en la raíz del repo no tiene carpeta, y por diseño
eso significa "grabación sin refinar, sin módulo". `error` es `null` cuando la prueba
pasó y puede ser un stacktrace largo cuando falla (la columna es `TEXT`).

**Errores:** `404` si el id no existe; `403` si el rol no es `QA_LEAD`; `401` sin token
o con token vencido.

## Frontend

**`src/api/client.js`** (nuevo) — envoltorio de `fetch`:

- URL base desde `import.meta.env.VITE_API_URL`.
- Adjunta `Authorization: Bearer <token>`.
- Desenvuelve el `ApiResponse` y lanza el `message` del backend cuando `success` es
  `false`.
- **Trata el 401 como sesión vencida:** borra el token y manda al login. Sin esto, al
  vencer el JWT a las 24 h el panel se llena de pantallas vacías sin explicar por qué.

**`LoginScreen.jsx`** — hoy entra con cualquier cosa. Pasa a llamar a
`POST /api/auth/login`, guardar el token y mostrar el error real del backend.
**Si el rol que devuelve el login no es `QA_LEAD`, rechaza el ingreso ahí mismo** con
un mensaje claro; si no, un analista entra bien y después ve todas las pantallas
fallando con 403, que parece un error del sistema.

**`ResultsTab.jsx`** — consume el listado real con paginación y estado de carga. Al
hacer clic en una corrida, muestra el detalle prueba por prueba.

**Contexto (`AppContext.jsx`)** — deja de leer `seed.js` para lo que ya es real. El
seed no se borra: queda para las pestañas ocultas, que se irán conectando en las
rebanadas siguientes.

**El token va en `localStorage`.** Es lo apropiado para un piloto interno. La
contrapartida es que un XSS en el panel puede leerlo, y eso empeora cuando la
aplicación muestre texto escrito por usuarios (las notificaciones de la rebanada 3).
**Revisar entonces**, no ahora.

## Despliegue

**Static Site** en Render: gratis y no se duerme, porque es CDN y no un servidor.
Build `npm run build`, directorio de publicación `dist`.

Configuración necesaria:

| Dónde | Variable | Valor |
|---|---|---|
| Static Site | `VITE_API_URL` | `https://reportras-backe.onrender.com` |
| Backend (Render) | `CORS_ALLOWED_ORIGINS` | el origen del panel, p. ej. `https://qa-panel.onrender.com` |

El nombre de la variable en Render es `CORS_ALLOWED_ORIGINS`, en mayúsculas y con
guiones bajos: la propiedad que lee `SecurityConfig` es `cors.allowed-origins` y Spring
la resuelve por *relaxed binding*. Escribirla con puntos en el panel de Render no
funciona.

**Trampa:** Vite congela las variables `VITE_*` en tiempo de build; no las lee en
runtime. Cambiar `VITE_API_URL` exige **redesplegar** el estático, no alcanza con
reiniciarlo.

**Arranque en frío:** el panel es instantáneo pero su primera consulta espera los ~2
minutos que tarda en despertar el backend dormido (medido: 116 s de arranque más los
ciclos de detección de puerto de Render). El estado de carga tiene que decirlo con
palabras, no ser un spinner mudo.

## Testing

**Backend:** tests `MockMvc` siguiendo el patrón del repositorio.

- El listado devuelve las corridas ordenadas por `receivedAt` descendente.
- La paginación respeta `page` y `size` y reporta bien `totalElements`.
- El filtro por `projectId` excluye las corridas de otros proyectos.
- El detalle trae los resultados de esa corrida, con `module` nulo cuando corresponde.
- `403` para `QA_ANALYST`, `404` para un id inexistente.

La suite pasa de 31 a ~35.

**Frontend:** no tiene infraestructura de tests y **no se agrega en esta rebanada** —
sumar Vitest es un proyecto en sí. Se verifica a mano contra el backend real.

## Reparto del trabajo

Las dos mitades son independientes una vez fijado el contrato de arriba:

- **Backend** (endpoints, DTOs, seguridad, tests): Claude.
- **Frontend** (`client.js`, login real, pantalla de corridas): Codex, trabajando
  contra el contrato escrito, no contra la implementación.

El contrato tiene que estar cerrado **antes** de arrancar. Si queda vago, cada mitad
adivina distinto y la integración cuesta más de lo que ahorró el paralelismo.

## Riesgos

- **CORS, JWT en el navegador y despliegue del estático no están probados.** Es la
  razón de ser de esta rebanada; se resuelven acá o se resuelven al final, peor.
- **El modelo del seed no mapea al del backend.** Reacomodar `AppContext` puede
  arrastrar más cambios de los previstos en componentes que hoy asumen la forma del
  seed.
- **La serialización de fechas está asumida, no verificada.** Se da por hecho que
  Spring Boot emite ISO-8601 para `LocalDateTime`; la primera tarea del plan debe
  confirmarlo contra una respuesta real antes de que el frontend construya sobre eso.
