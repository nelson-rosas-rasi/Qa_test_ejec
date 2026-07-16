# Conexión de la cuenta de GitHub — estado en el perfil, conectar y desconectar

**Fecha:** 2026-07-16
**Estado:** aprobado, pendiente de plan de implementación

## Problema

Todo lo que hace la app contra el repositorio —traer un proyecto, actualizarlo,
listar las pruebas— pasa por `git` en `main/projects.js`, y hoy ese `git` se
invoca **sin credenciales**. Funciona sólo si el repositorio es público o si el
PC ya tiene credenciales configuradas por fuera de la app, algo que un QA no
técnico no va a haber hecho.

Los repositorios de pruebas del equipo son privados y viven en GitHub. Cada QA
tiene su cuenta y esa cuenta debe tener acceso al repositorio; si no lo tiene, no
hay pruebas que mostrar. Hoy ese caso no se distingue de ningún otro fallo: sale
como `REPOSITORY_UNAVAILABLE` con las dos últimas líneas del `stderr` de `git`
pegadas detrás (`friendlyCommandError`, `projects.js:47`), que al QA no le dicen
nada ni le indican qué hacer.

Además, el perfil del sidebar (`index.html:68-77`) muestra nombre y cargo pero no
dice nada sobre la cuenta, así que no hay forma de saber si estás conectado ni
sitio desde donde conectarte.

## Alcance

Vincular la cuenta de GitHub del QA a la app: conectarla, mostrar su estado en el
perfil, desconectarla, y usarla al invocar `git`.

**Fuera de alcance:**

- El servidor Spring Boot que a futuro recibirá pruebas y métricas de cada
  escritorio. No se diseña ni se prepara nada para él en esta rebanada.
- Revocar el acceso en GitHub al desconectar (ver *Decisiones*, punto 3).
- Varias cuentas por PC, o una cuenta por perfil de QA / por proyecto (punto 2).
- Escribir en el repositorio. La app sólo lee (`clone`, `fetch`).
- Los handlers todavía simulados (`sync:checkStatus`, `sync:update`,
  `report:generate`, `history:list`) no se tocan.

## Prerequisito bloqueante

Hace falta **registrar una OAuth App (o una GitHub App, ver Riesgos) en la
organización** y obtener su `client_id`. El device flow no usa secreto de
cliente, así que el `client_id` puede compilarse en la app y distribuirse sin
riesgo.

Sin ese dato no hay flujo real que probar. El diseño lo lee de una constante en
`main/github/config.js`, sobreescribible con la variable de entorno
`QA_GITHUB_CLIENT_ID` para desarrollo. Todo lo demás se prueba con dobles, así
que la implementación puede avanzar completa; lo único que queda pendiente del
`client_id` es la verificación manual end-to-end.

## Decisiones tomadas

1. **"Conectado" es un hecho local:** significa que hay un token guardado en este
   PC, no que GitHub responda ahora mismo. La identidad se verifica aparte y se
   cachea. Sin esto, un QA sin internet vería "desconectado" y se pondría a
   re-vincular su cuenta sin motivo.
2. **Una cuenta por instalación.** Un PC, una persona, una cuenta, válida para
   todos los proyectos. El perfil de QA sigue siendo "quién reporta"; la cuenta de
   GitHub es "con qué permisos se baja el repositorio". Si más adelante hiciera
   falta una cuenta por perfil, la clave de guardado se extiende sin rehacer el
   resto.
3. **Desconectar sólo borra el token de este PC.** Revocarlo del lado de GitHub
   exige el secreto de la OAuth App, que una app de escritorio no puede custodiar.
   El copy dice la verdad ("se olvidó la cuenta en este equipo") y ofrece el enlace
   a la configuración de GitHub para revocar de verdad.
4. **Sin cuenta se bloquea lo que necesita el repositorio**, en vez de dejar que
   la operación falle con el error crudo de `git`.

## Diseño

### 1. Modelo de estado

`github:status` resuelve estas cuatro situaciones:

| Situación | Respuesta | Qué ve el QA |
|---|---|---|
| No hay token guardado | `{ connected: false }` | "Sin cuenta conectada" + franja ámbar |
| Hay token y `GET /user` responde 200 | `{ connected: true, login, name, avatarUrl }` | Punto verde, "Conectado como *login*" |
| Hay token y `GET /user` responde 401 | `{ connected: false, reason: 'EXPIRED' }` | Se borra el token; "Tu cuenta dejó de estar conectada" |
| Hay token y falla la red | `{ connected: true, ...identidadCacheada, stale: true }` | Punto verde con el nombre cacheado |

El bloqueo se decide únicamente por `connected`.

### 2. `main/github/device-flow.js`

Sin dependencias de Electron. Recibe `fetch` y `sleep` inyectados, como
`projects.js` recibe `run`.

- `requestDeviceCode({ clientId, scope, fetch })` → `POST https://github.com/login/device/code`
  con `client_id` y `scope`, `Accept: application/json`. Devuelve
  `{ deviceCode, userCode, verificationUri, interval, expiresIn }`. El `scope` es
  `repo` si se va con OAuth App (ver Riesgos).
- `pollForToken({ clientId, deviceCode, interval, expiresIn, fetch, sleep, signal })` →
  `POST https://github.com/login/oauth/access_token` con
  `grant_type=urn:ietf:params:oauth:grant-type:device_code`, en bucle hasta
  agotar `expiresIn`. Devuelve el token o lanza `appError`.

Respuestas del bucle que hay que tratar por separado:

- `authorization_pending` → seguir esperando (caso normal).
- `slow_down` → adoptar el `interval` que devuelve la respuesta. Ignorarlo hace
  que GitHub corte el flujo.
- `expired_token` → `GITHUB_CODE_EXPIRED`.
- `access_denied` → `GITHUB_ACCESS_DENIED`.

`signal` permite cancelar desde el botón Cancelar del modal.

### 3. `main/github/account.js`

`createAccountStore({ store, safeStorage })`. No sabe de red.

- `save(token, identity)` — `safeStorage.encryptString(token)` → Buffer → base64,
  guardado bajo la clave global `github`. La identidad se guarda en claro (no es
  secreta) para poder pintar el perfil sin red.
- `load()` → `{ token, identity, verifiedAt } | null`.
- `clear()` — borra la clave entera.

Antes de guardar comprueba `safeStorage.isEncryptionAvailable()`; si es `false`,
lanza `SECURE_STORAGE_UNAVAILABLE` y **no guarda nada en claro como
alternativa**. En Windows esto se apoya en DPAPI, atado a la cuenta de Windows:
otro usuario del mismo PC no puede descifrar el token.

Forma en `config.json`:

```json
{
  "projects": { },
  "github": {
    "token": "<base64 del buffer cifrado>",
    "identity": { "login": "maria-gomez", "name": "María Gómez", "avatarUrl": "..." },
    "verifiedAt": "2026-07-16T14:00:00.000Z"
  }
}
```

### 4. `config-store.js` gana acceso a claves globales

El store de hoy sólo sabe de proyectos (`listProjects`, `getProject`,
`setProject`); no hay dónde poner algo de alcance global. Se le añaden dos
métodos que leen y escriben en la raíz del JSON:

- `getSetting(key)` → valor o `undefined`.
- `setSetting(key, value)` — mezcla sobre la raíz **sin tocar `projects`**.

Es el único cambio en un módulo ya probado; su test se extiende en consecuencia.

### 5. `main/github/identity.js`

`fetchIdentity({ token, fetch })` → `GET https://api.github.com/user`.

- 200 → `{ login, name, avatarUrl }`.
- 401 → lanza `GITHUB_TOKEN_INVALID`, que es lo que dispara el borrado automático.
- Fallo de red → lanza `GITHUB_UNREACHABLE`, que es lo que deja el estado `stale`.

Distinguir estos dos fallos es lo que sostiene el modelo de estado del punto 1;
colapsarlos rompe el caso "sin internet".

### 6. `main/github/git-auth.js`

Convierte un token en la forma de invocar `git` autenticado.
`createGitAuth(getToken)` devuelve el objeto `auth` que consume `projects.js`:

- `auth.args()` → los `-c` que hay que anteponer (vacío si no hay token).
- `auth.env()` → `{ QA_GH_TOKEN: token, GIT_TERMINAL_PROMPT: '0' }`.

`getToken` es una función, no el token: así una desconexión a mitad de sesión se
refleja en la siguiente invocación de `git` sin recrear el manager.

```
-c credential.https://github.com.helper=
-c credential.https://github.com.helper=!f() { test "$1" = get && printf 'username=x-access-token\npassword=%s\n' "$QA_GH_TOKEN"; }; f
```

Cuatro cosas deliberadas, todas con su motivo:

- **El token va en el entorno, nunca en los argumentos.** La línea de comandos de
  un proceso es visible desde el administrador de tareas y desde `ps`; el entorno
  no lo es para otros usuarios. Esta regla se prueba explícitamente.
- **El ayudante está acotado a `https://github.com`**, no a `credential.helper` a
  secas, para que el token no se ofrezca nunca a otro servidor.
- **La primera línea vacía limpia los ayudantes heredados**, para que el Git
  Credential Manager del PC no se meta con su propia ventana.
- **`GIT_TERMINAL_PROMPT=0`**: si la credencial falla, `git` intentaría preguntar
  por teclado y se quedaría colgado para siempre, porque lo lanza `execFile` sin
  terminal. Con esto falla rápido y con error legible.

El ayudante `!f() {...}` corre bajo el `sh` que Git trae consigo, así que funciona
igual en Windows.

### 7. Integración con `projects.js`

`createProjectManager` acepta un parámetro más, `auth` (por defecto, uno que no
inyecta nada — así los tests actuales siguen pasando sin tocarlos). Su `git()`
interno pasa a:

```js
const git = (args, cwd) => run(gitPath, [...auth.args(), ...args], {
  ...(cwd ? { cwd } : {}),
  env: { ...process.env, ...auth.env() },
});
```

No cambia ninguna otra línea de `projects.js`: `initialize`, `importExisting` y
`prepare` heredan la autenticación por pasar todas por `git()`.

`friendlyCommandError` gana un caso: si el `stderr` de `git` delata un 403/404 o
un fallo de autenticación, se traduce a `REPOSITORY_ACCESS_DENIED` en vez de al
genérico con el `stderr` pegado.

### 8. IPC y preload

En `main/ipc.js`:

- `github:status` → el modelo del punto 1. Verifica identidad y refresca la caché.
- `github:connect` → arranca el device flow. Emite `github:deviceCode` con
  `{ userCode, verificationUri }` en cuanto GitHub lo entrega, para que el modal
  pinte el código mientras el `handle` sigue esperando la aprobación. Resuelve
  `{ ok: true, account }` o `{ ok: false, error, code }`, siguiendo el estilo de
  `projects:initialize`.
- `github:disconnect` → `clear()`, devuelve `{ ok: true }`.
- `github:cancelConnect` → aborta el `signal` del flujo en curso.

Sólo puede haber un device flow a la vez; se guarda en un `currentDeviceFlow`, tal
como `ipc.js` hace hoy con `currentRun`.

En `preload.js`, bajo `window.qa`: `getGithubStatus`, `connectGithub`,
`disconnectGithub`, `cancelGithubConnect`, `onGithubDeviceCode`.

El stub de navegador del final de `renderer.js` (el que permite abrir
`index.html` sin Electron) gana las mismas funciones, devolviendo una cuenta
conectada de mentira.

### 9. Renderer: el estado en el perfil

```
Conectado                        Desconectado
┌────────────────────────┐      ┌────────────────────────┐
│ (MG)● María Gómez      │      │ ⚠ Sin cuenta conectada │
│      QA Senior         │      │   Conectar cuenta      │
└────────────────────────┘      ├────────────────────────┤
   punto verde en el avatar     │ (MG)● María Gómez      │
                                │      QA Senior         │
                                └────────────────────────┘
                                   punto gris + franja ámbar
```

El punto de color sobre el avatar lleva el estado permanente. Desconectado, además,
aparece una franja ámbar encima del perfil con la acción a mano: en ese estado la
app está capada, así que el aviso se gana el sitio. Conectado, el punto verde basta
y no roba atención.

El menú de perfil, que hoy lista los perfiles del repo, gana una sección al final,
separada por una línea:

- Conectado: "Conectado como *maria-gomez*" + "Desconectar cuenta".
- Desconectado: "Conectar cuenta de GitHub".

### 10. Renderer: el modal de conexión

```
  Conectar tu cuenta de GitHub

  1. Copia este código:   [ WDJB-MJHT ]  [Copiar]
  2. Apruébalo en GitHub, que se abrirá en tu navegador.

  Esperando tu aprobación…        [Abrir GitHub]  [Cancelar]
```

"Abrir GitHub" usa `shell.openExternal(verificationUri)` desde el main. Al aprobar,
el modal se cierra solo y el perfil pasa a conectado. Cancelar aborta el flujo.

Desconectar pide confirmación y avisa de lo que **no** hace: que la cuenta se
olvida en este equipo pero sigue autorizada en GitHub, con el enlace a
`https://github.com/settings/applications` para revocarla del todo.

### 11. Bloqueo sin cuenta

Con `connected: false` quedan deshabilitados, con su motivo al pasar por encima:

- "Traer repositorio" / "Traer carpeta clonada" (el modal de proyecto).
- Actualizar (la `sync-pill`).
- Ejecutar pruebas.

Siguen disponibles el historial y los resultados ya descargados: son datos locales
y no necesitan cuenta.

### 12. Errores

Todos con `appError`, como el resto de `main/`:

| Código | Mensaje para el QA |
|---|---|
| `GITHUB_CODE_EXPIRED` | "El código caducó. Vuelve a intentarlo." |
| `GITHUB_ACCESS_DENIED` | "No se autorizó el acceso. Puedes intentarlo otra vez." |
| `GITHUB_UNREACHABLE` | "No se pudo contactar con GitHub. Revisa tu conexión." |
| `GITHUB_TOKEN_INVALID` | "Tu cuenta dejó de estar conectada. Conéctala de nuevo." |
| `SECURE_STORAGE_UNAVAILABLE` | "Este equipo no puede guardar la cuenta de forma segura." |
| `REPOSITORY_ACCESS_DENIED` | "Este proyecto no existe o tu cuenta no tiene acceso. Pídeselo al responsable." |
| `GITHUB_NOT_CONNECTED` | "Conecta tu cuenta de GitHub para continuar." |

`REPOSITORY_ACCESS_DENIED` cubre a propósito los dos casos en una sola frase:
GitHub responde **404, no 403**, ante un repositorio privado al que tu cuenta no
tiene acceso, para no filtrar su existencia. Distinguir "no existe" de "no tienes
permiso" es imposible desde fuera, y el mensaje no debe fingir que sí.

### 13. Copy

Sin "token", "OAuth", "scope", "device flow" ni "credencial" en ningún texto
visible, según la regla del README. Se dice "cuenta", "conectar", "código",
"aprobar". "GitHub" sí se nombra: es el sitio al que la persona va a entrar y
esconderlo la confundiría más.

## Riesgos

- **El `scope=repo` de una OAuth App concede más de lo que la app necesita.** La
  app sólo lee, pero `repo` es el único scope de OAuth App que abre repositorios
  privados, y trae permiso de escritura sobre todos los repos privados a los que
  la persona tenga acceso. Una **GitHub App** con permiso `contents: read` sobre
  los repositorios elegidos sería mínimo privilegio y también soporta device flow.
  El coste es que sus tokens caducan (8 h) y hay que refrescarlos, lo que añade un
  ciclo de refresco al diseño. **Recomendación: preferir la GitHub App si la
  organización lo permite**, y decidirlo antes de implementar: cambia el punto 3
  del diseño (`account.js` tendría que guardar también el refresh token) y el
  punto 2 (el bucle tendría que renovar), así que sale caro decidirlo después.
- El ayudante de credenciales depende del `sh` que Git trae. Si un PC tuviera un
  Git sin ese `sh`, el ayudante no correría; conviene verificarlo temprano en un PC
  del equipo, no sólo en el de desarrollo.
- `safeStorage` sólo funciona tras `app.whenReady()`. `registerIpc` ya se llama
  ahí dentro (`main.js:26`), así que encaja, pero el store de la cuenta no puede
  construirse en el import del módulo.
- Los tests actuales cubren `main/`, no el renderer. Los puntos 9, 10 y 11 quedan
  sin red de seguridad automática y se verifican a mano.

## Verificación

Automática, con `node --test` y dobles, como los diez tests de `test/`:

1. `device-flow.test.js` — `authorization_pending` y luego éxito; `slow_down`
   adopta el nuevo intervalo; `expired_token`; `access_denied`; fallo de red.
2. `account.test.js` — guardar/leer/borrar con un `safeStorage` falso; con
   `isEncryptionAvailable()` en `false` lanza y no escribe nada.
3. `identity.test.js` — 200 devuelve identidad; 401 lanza `GITHUB_TOKEN_INVALID`;
   fallo de red lanza `GITHUB_UNREACHABLE` (los dos no se confunden).
4. `git-auth.test.js` — **el token está en el entorno y no aparece en los
   argumentos**; el ayudante está acotado a `https://github.com`;
   `GIT_TERMINAL_PROMPT` vale `0`.
5. `config-store.test.js` — `setSetting` no pisa `projects`.
6. `projects.test.js` — `git` se invoca con los argumentos y el entorno de
   autenticación; un `stderr` de 404 se traduce a `REPOSITORY_ACCESS_DENIED`.

Manual, con la app levantada (requiere el `client_id`):

1. Sin cuenta: franja ámbar, punto gris, y "Traer repositorio" deshabilitado.
2. Conectar: sale el código, se abre GitHub, al aprobar el perfil pasa a verde con
   el nombre real y se rehabilitan las acciones.
3. Cerrar y reabrir la app: sigue conectada (el token sobrevive).
4. Traer un repositorio privado al que la cuenta tiene acceso: funciona.
5. Traer uno al que no tiene acceso: sale `REPOSITORY_ACCESS_DENIED`, no el
   `stderr` de git.
6. Desconectar: confirma, avisa de que sigue autorizada en GitHub, y vuelve al
   estado del punto 1.
7. Con la app conectada y sin internet: sigue diciendo "conectado" con el nombre
   cacheado.
8. Revocar la app en GitHub y pulsar actualizar: se detecta el 401, se borra el
   token y el perfil pasa a desconectado.
9. `config.json` no contiene el token en claro en ningún momento.
