# Perfiles de QA editables — crear el .env desde la app

**Fecha:** 2026-07-17
**Estado:** aprobado, pendiente de plan de implementación

## Problema

Para ejecutar pruebas, cada QA necesita un archivo `.env.<perfil>` en el
repositorio con sus credenciales del ERP, la URL del entorno y datos de prueba.
El `playwright.config.ts` del repo ya lo consume:

```ts
const profile = process.env.QA_PROFILE;
const envFile = profile ? `.env.${profile}` : '.env';
dotenv.config({ path: envPath });
```

Y la cadena que lo alimenta ya existe de punta a punta: el selector de perfil del
sidebar guarda el perfil elegido (`ipc.js` `profiles:select`), y `run-tests.js`
lo inyecta como `QA_PROFILE` al lanzar Playwright.

**Pero no hay forma de crear ese `.env` desde la app.** Los `.env.*` están en el
`.gitignore` del repo (son secretos), así que un clon recién hecho nunca los trae
—es imposible por construcción—, y `profiles.js` los busca dentro del clon. El
resultado es un callejón sin salida: `listProfiles` lanza `NO_PROFILE` ("Este
proyecto no tiene perfiles de QA configurados") y el QA no tiene ningún camino
dentro de la app para salir de ahí. Hoy solo se desbloquea dejando un archivo a
mano en `%APPDATA%\runqa\projects\<id>\`, una ruta que ningún QA conoce ni debería.

## Alcance

Un formulario en la app para crear y editar el perfil de QA (el `.env`), guardado
de forma segura fuera del clon y materializado dentro del clon solo mientras hace
falta.

**Fuera de alcance:**

- Cambiar el `playwright.config.ts` del repo de pruebas. La app se adapta a lo que
  el repo ya espera (un archivo `.env.<perfil>` en la raíz del clon), no al revés.
- Importar perfiles antiguos. En el clon administrado no puede haber ninguno
  legítimo —git nunca los trae— así que no hay nada que importar. El `.env.nelson`
  creado a mano durante la depuración es un resto y será barrido (ver Ciclo de vida).
- Editar el `.env.example`. Es del repo, está commiteado, y aquí solo se lee.
- Migrar la carpeta de datos huérfana de `qa-test-runner` a `runqa` (efecto del
  rebrand). Es un problema aparte, anotado como riesgo.

## Decisiones tomadas

1. **El formulario muestra todas las claves, leídas del `.env.example`.** El repo
   ya documenta cada clave ahí con comentarios y valores por defecto. La app no
   codifica ningún nombre de clave de este repo: sirve para cualquier proyecto
   Playwright que traiga un `.env.example`, y una clave nueva en el ejemplo aparece
   sola en el formulario.
2. **El perfil maestro vive fuera del clon, cifrado.** En
   `%APPDATA%\runqa\perfiles\<proyecto>\<perfil>.enc`, cifrado con `safeStorage`
   (la misma pieza que protege el token de GitHub). Sobrevive a actualizaciones,
   reclonados y a borrar/re-añadir el proyecto.
3. **El `.env` en claro solo existe en el clon mientras el proyecto está abierto.**
   Se escribe al abrir el proyecto y se borra al cerrarlo o al cerrar la app. La
   contraseña del ERP no queda reposando en claro en el disco de forma permanente.
4. **Al arrancar, la app barre restos.** Un cierre limpio borra el `.env`; un
   cuelgue, no. Sin un barrido al arranque, la promesa del punto 3 es falsa justo
   el día que la app se cae. Ver Ciclo de vida.

## Diseño

### 1. `main/profiles/schema.js` — el `.env.example` como esquema

`parseEnvExample(text)` → `[{ key, value, help }]`:

- `key` / `value`: cada línea `CLAVE=valor`.
- `help`: los comentarios `#` que preceden inmediatamente a la clave, unidos.
- Las líneas de separación decorativa (p. ej. `# ─── Horas ───`) y las líneas en
  blanco entre bloques no generan campos ni se acumulan como ayuda espuria.

**Cuidado con la regex de la clave: debe aceptar dígitos.** `N8N_WEBHOOK_URL` y
`GOOGLE_TEMPLATE_DOC_ID` son claves válidas; una regex `[A-Z_]+` las descarta en
silencio. Usar `[A-Z_][A-Z0-9_]*`. (Este bug ya se cometió una vez contando las
claves a mano durante el diseño; queda clavado en un test.)

Sin dependencias de Electron: recibe el texto, no una ruta.

### 2. `main/profiles/store.js` — la copia maestra cifrada

`createProfileStore({ dir, safeStorage })`, un archivo por perfil bajo
`dir/<proyecto>/<perfil>.enc`:

- `list(projectId)` → `[{ id, name, role }]` (nombre y cargo se leen de las claves
  `QA_NOMBRE`/`QA_CARGO` del perfil descifrado, para pintar el sidebar).
- `save(projectId, id, values)` — cifra el objeto de valores y lo escribe.
- `load(projectId, id)` → `values` o `null`.
- `remove(projectId, id)`.

Antes de guardar comprueba `safeStorage.isEncryptionAvailable()`; si no, lanza
`SECURE_STORAGE_UNAVAILABLE` (código ya existente) y no escribe nada en claro. Un
perfil ilegible (cifrado por otra cuenta de Windows) se trata como inexistente, no
como error — mismo patrón que `account.js`. No sabe nada del clon.

### 3. `main/profiles/materialize.js` — el puente al clon

- `write({ repoPath, id, values })` — escribe `.env.<id>` en la raíz del clon, en
  claro, con las claves en el orden del esquema.
- `sweep(repoPath)` — borra todos los `.env.*` de la raíz del clon **excepto
  `.env.example`**. Ese está commiteado, no es nuestro, y es la fuente del esquema:
  borrarlo rompería el repo del QA y el formulario. Es la aserción de seguridad
  central de esta rebanada.

Nota: `prepare()` en `projects.js` hace `git clean -fd` **sin `-x`**, así que no
toca archivos ignorados; el `.env` materializado sobrevive a una actualización de
rama. El borrado es responsabilidad nuestra (ciclo de vida), no de git.

### 4. `main/profiles.js` — cambia de fuente

Hoy lee los `.env.*` del clon. Pasa a:

- `readSchema(repoPath)` — lee y parsea el `.env.example` del clon (vía `schema.js`).
  Si no existe, lanza `PROFILE_TEMPLATE_MISSING`.
- `listProfiles` desaparece de aquí: la lista de perfiles ahora la da el `store`,
  no el repo. Los consumidores en `ipc.js` pasan a llamar al store.

### 5. Ciclo de vida del `.env` materializado

| Momento | Acción |
|---|---|
| `app.whenReady` | `sweep` de cada clon: `store.listProjects()` da los proyectos, y se barre el `repoPath` de cada uno que exista en disco |
| Se abre / cambia de proyecto | `sweep` del clon + `write` del perfil activo |
| Se cambia de perfil activo | `sweep` + `write` del nuevo |
| Se cierra el proyecto | `sweep` |
| `before-quit` / `window-all-closed` | `sweep` de cada clon |

El barrido al arranque (`app.whenReady`) es lo que hace honesta la promesa de "se
quita al cerrar": cubre el caso del cierre sucio. Se engancha en `main.js` (hoy
`window-all-closed` en la línea 34) y en el `app.whenReady` que ya llama a
`registerIpc`.

Si no hay perfil activo para un proyecto, no se escribe nada: el `sweep` deja el
clon sin `.env.<id>`. En ese estado la app muestra el formulario de crear perfil
(punto 8) en lugar de la pantalla del proyecto, así que no se llega a ejecutar sin
perfil. No se añade un guard nuevo en el flujo de ejecución: la ausencia de
pantalla de proyecto ya lo impide.

### 6. Identificador del perfil

`id` = slug de `QA_NOMBRE`, reutilizando `slugify` de `projects.js`. "María Gómez"
→ `maria-gomez` → `.env.maria-gomez`. Colisión: sufijo numérico, como
`uniqueProjectId`. El `id` es estable una vez creado (no se recalcula al editar el
nombre, para no huerfanar el archivo cifrado).

### 7. IPC y preload

Reemplaza/añade en `ipc.js`, sobre el bloque de perfiles actual:

- `profiles:list` → `store.list(projectId)`.
- `profiles:schema` → `readSchema(repoPath)` (para pintar el formulario).
- `profiles:save` → `store.save(...)`, devuelve `{ ok, profile }` o `{ ok:false, error, code }`.
- `profiles:remove` → `store.remove(...)`.
- `profiles:active` / `profiles:select` — como hoy, pero `select` además dispara
  `sweep` + `write` del nuevo perfil en el clon.

`preload.js` expone: `listProfiles`, `getProfileSchema`, `saveProfile`,
`removeProfile`, `getActiveProfile`, `selectProfile`.

### 8. Renderer: el formulario

Sustituye al `dialog.showErrorBox` nativo que hoy dispara `NO_PROFILE`. Sin
perfiles, la pantalla del proyecto invita a crear en vez de acusar:

```
  Crea tu perfil para este proyecto

  Tu nombre          [ ... ]        ← QA_NOMBRE
  Usuario            [ ... ]        ← TEST_USERNAME
  Contraseña         [ •••• ]       ← enmascarado
  ...                               (todas las claves, con scroll)
    <comentario del .env.example como ayuda bajo cada campo>

                        [Cancelar]  [Guardar perfil]
```

- Un campo por clave del esquema, precargado con el `value` del ejemplo, con `help`
  debajo.
- Los campos cuya clave contenga `PASSWORD`, `TOKEN` o `SECRET` (heurística
  genérica, no específica del repo) se pintan como `type=password`.
- "Añadir perfil" entra en el menú del perfil, junto a la fila de la cuenta de
  GitHub, para crear el segundo y siguientes.
- El stub de navegador (`createBrowserStub`) gana `getProfileSchema`/`saveProfile`/
  `removeProfile` con datos de ejemplo.

### 9. Copy

Sin ".env", "variable de entorno", "dotenv", "plantilla" en texto visible, igual
que la regla que ya aplica la cuenta de GitHub. Se dice "perfil", "configuración",
"tus datos". "Contraseña" y "usuario" sí, son del dominio del QA.

### 10. Errores

| Código | Mensaje |
|---|---|
| `PROFILE_TEMPLATE_MISSING` | "Este proyecto no trae la plantilla de configuración. Avisa al responsable." |
| `SECURE_STORAGE_UNAVAILABLE` | "Este equipo no puede guardar tu perfil de forma segura." (ya existe) |

"No hay perfiles" deja de ser un error: es la pantalla de crear.

## Riesgos

- **Ventana de exposición en claro.** Mientras el proyecto está abierto, el
  `.env.<id>` con la contraseña vive en claro en el clon. Es lo aprobado
  (enfoque A) y es como funciona cualquier proyecto Playwright; el barrido al
  cierre y al arranque acota la ventana pero no la elimina. La alternativa sin
  archivo (pasar todo por entorno) exigía cambiar el `playwright.config.ts` del
  repo, fuera de alcance.
- **La carpeta de datos huérfana del rebrand.** Al renombrar la app a `runqa`,
  Electron cambió `%APPDATA%\qa-test-runner` por `%APPDATA%\runqa`. Cualquier dato
  previo (incluida la cuenta de GitHub ya conectada) quedó huérfano. No lo resuelve
  esta rebanada; se anota para decidir aparte.
- **`sweep` opera sobre rutas administradas.** Solo debe barrer clones bajo
  `projectsDir`; un bug que lo apunte a otra carpeta borraría `.env` ajenos.
  `validateManagedPath` (ya en `projects.js`) debe proteger cada `sweep`.
- El renderer no tiene tests automáticos (los 99 cubren `main/`). El formulario
  (punto 8) se verifica a mano.

## Verificación

Automática, con `node --test` y dobles, como los 99 tests actuales:

1. `schema.test.js` — parsea claves con dígitos (`N8N_WEBHOOK_URL`); asocia los
   comentarios `#` como `help`; ignora separadores decorativos; respeta valores con
   `=` dentro (URLs).
2. `store.test.js` — guardar/leer/borrar cifrado; la contraseña no aparece en claro
   en el `.enc`; sin cifrado disponible lanza y no escribe; perfil ilegible → null;
   `list` devuelve nombre y cargo.
3. `materialize.test.js` — **`sweep` nunca borra `.env.example`** mientras borra
   `.env.maria`, `.env.nelson`, etc.; `write` produce un `.env` que `dotenv` puede
   releer; `sweep` sobre carpeta sin `.env.*` no falla.
4. `profiles.test.js` — `readSchema` lanza `PROFILE_TEMPLATE_MISSING` sin ejemplo.

Manual, con la app:

1. Proyecto recién traído, sin perfil: sale el formulario, no el error `NO_PROFILE`.
2. Rellenar y guardar: aparece el perfil en el sidebar; el `.env.<id>` existe en el
   clon; ejecutar una prueba usa esos valores.
3. Cerrar la app: el `.env.<id>` desaparece del clon; el `.enc` cifrado permanece.
4. Reabrir: el perfil sigue ahí y el `.env` se regenera.
5. Matar la app a la fuerza (deja el `.env` huérfano) y reabrir: el barrido al
   arranque lo limpia antes de reescribirlo.
6. Añadir un segundo perfil y alternar: el `.env.<id>` del clon cambia con la
   selección.
7. El `.enc` del perfil no contiene la contraseña en claro.
