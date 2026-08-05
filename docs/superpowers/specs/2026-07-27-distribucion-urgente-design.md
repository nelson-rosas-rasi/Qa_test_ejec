# Distribución de RunQA: lo urgente antes del onboarding — Diseño

Fecha: 2026-07-27
Estado: aprobado
Alcance: **RunQA (Electron)** — `Qa_test_ejec/electron-app`

## Contexto

RunQA ya se empaqueta para Windows: `npm run dist` genera `RunQA Setup 1.4.0.exe`,
su `.blockmap` y `latest.yml` en `electron-app/dist/`, usando `electron-builder`
(NSIS) + `electron-updater`. La suite (`npm test`) está en **224/224 verde**.

### Este spec es una pieza de un roadmap mayor

| Pieza | Estado |
|---|---|
| **A. Onboarding, instalador y dependencias** | **parcial — este spec cubre solo la mitad "distribución"** |
| B. Conexión e identidad | hecho |
| C. Ingesta de corridas y sincronización de módulos | hecho |
| D. Métricas y coverage medido | pendiente |
| E. Grabaciones: inventario, asignación y control | pendiente |
| F. Evidencia (PDF) a Drive y solape con n8n | pendiente |

La pieza A completa (asistente de primer arranque, verificación de Git/Node/
Playwright, instalación controlada de dependencias y navegadores) queda **fuera**
de este spec — se decidió acotar esta ronda a lo que bloquea distribuir la app
tal como está hoy, y tratar el asistente de onboarding como un spec propio más
adelante.

Tres problemas reales impiden distribuir RunQA hoy:

1. `main/updater.js` llama `autoUpdater.checkForUpdates()` dos veces (al abrir y
   en un `setInterval` cada hora) **sin `.catch()`**. Si GitHub responde 404
   (porque el repo de releases no existe o no tiene releases todavía), la
   promesa se rechaza sin manejar, además de disparar el listener `'error'`.
2. `package.json` → `build.publish` tiene `owner`/`repo` ficticios
   (`CAMBIAME-usuario-u-org` / `runqa-releases`). No sabemos todavía el valor
   real, así que la config debe quedar **centralizada en un solo lugar**,
   con una guarda que impida publicar por error mientras siga con el
   placeholder puesto.
3. No hay ninguna dirección documentada de dónde baja alguien el instalador
   inicial, ni pasos escritos para cortar una release.

## Fuera de alcance (YAGNI / pieza A completa después)

- Asistente de primer arranque (wizard UI).
- Verificación de Git/Node/npm/Playwright instalados en la máquina del QA.
- Instalación controlada de dependencias del repo de pruebas y de los
  navegadores de Playwright.
- Cualquier cambio a las pantallas de `renderer/`.

## Decisiones tomadas

1. **La config de GitHub Releases sigue viviendo solo en `package.json` →
   `build.publish`** (ya es lo que lee `electron-builder`). No se introduce un
   segundo archivo de config: cualquier otro lugar que necesite el owner/repo
   (como la página de descarga) **referencia esos mismos valores en prosa**, en
   vez de copiarlos, para que no puedan desincronizarse.
2. **Guarda en el script `release`, no en `dist`.** `npm run dist` (build local,
   no publica) queda igual. `npm run release` (`--publish always`) pasa a
   correr primero un script que aborta si detecta el placeholder puesto.
3. **El fix del updater es puramente defensivo:** no cambia el comportamiento
   visible (la app ya no molestaba al usuario con errores de red al chequear;
   el listener `'error'` ya lo logueaba). Solo evita el rechazo sin manejar.
4. **La pasarela de descarga es un README, no una página web nueva.** No hay
   hosting decidido todavía (¿GitHub Pages? ¿un link compartido?); documentar
   el patrón de URL de GitHub Releases en el README ya resuelve "existe una
   dirección documentada" sin comprometernos a infraestructura que no se pidió.

## Diseño

### 1. `main/updater.js`

Las dos llamadas:

```js
autoUpdater.checkForUpdates();
setInterval(() => autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
```

pasan a:

```js
const checkForUpdates = () =>
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] no se pudo revisar actualizaciones:', err?.message || err);
  });

checkForUpdates();
setInterval(checkForUpdates, CHECK_INTERVAL_MS);
```

Mismo formato de mensaje que ya usa `autoUpdater.on('error', ...)`, para no
introducir un segundo estilo de log.

### 2. `scripts/check-release-config.js` (nuevo)

Script standalone (sin dependencias de Electron, como el resto de `main/`):
lee `package.json`, mira `build.publish.owner` y `build.publish.repo`, y si
alguno todavía contiene el placeholder (`CAMBIAME-usuario-u-org` /
`runqa-releases`) imprime un mensaje señalando exactamente
`package.json` → `build.publish` como el lugar a editar, y sale con código 1.
Si los valores ya cambiaron, sale con código 0 sin imprimir nada.

`package.json`:

```json
"scripts": {
  "release": "node scripts/check-release-config.js && electron-builder --publish always"
}
```

### 3. `electron-app/README.md` — sección nueva "Distribución y actualizaciones"

Agregada al final del README existente. Cubre:

- **Descarga inicial:** `https://github.com/{owner}/{repo}/releases/latest`,
  explicando que `{owner}/{repo}` son los de `package.json` → `build.publish`
  (hoy con placeholder — se actualiza esta sección solo de forma indirecta,
  señalando la fuente de verdad, no repitiendo el valor).
- **Cortar una release:** bump de versión en `package.json`, `npm run dist`
  para verificar el build localmente, `GH_TOKEN=<token> npm run release` para
  publicar (el token necesita permiso `repo` sobre el repo de releases), qué
  archivos sube electron-builder (`.exe`, `.blockmap`, `latest.yml`) y por qué
  los tres son necesarios (el `.blockmap` habilita descargas incrementales del
  lado de `electron-updater`; `latest.yml` es lo que consulta el cliente).

## Errores y casos borde

- **`check-release-config.js` corriendo sin `package.json` en el cwd
  esperado:** el script asume que se invoca desde `electron-app/` (igual que
  el resto de scripts de npm) — no necesita resolver rutas raras.
- **Placeholder parcialmente cambiado** (por ejemplo, solo `owner` real pero
  `repo` sigue en `runqa-releases`): la guarda revisa ambos campos por
  separado y reporta cuál falta.

## Testing

- `main/updater.js` no tiene tests hoy (depende de `electron`, `dialog`,
  `Notification` sin inyección) — no se agrega arnés de test nuevo para esto;
  se verifica manualmente que el `.catch()` compila y no cambia el flujo
  normal (dev sigue sin correr el updater por el guard de `app.isPackaged`).
- `scripts/check-release-config.js`: verificación manual, no automatizada
  (script de un archivo, sin lógica de negocio que amerite `node:test`) —
  correrlo con el placeholder puesto (debe fallar) y con un valor cambiado
  (debe pasar).
- Suite completa: `npm test` debe seguir en 224/224 al terminar.
