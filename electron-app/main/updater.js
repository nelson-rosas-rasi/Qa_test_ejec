const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

/**
 * Auto-actualización de la app (no de los tests).
 *
 * Flujo: al abrir, la app consulta el `latest.yml` publicado en GitHub Releases.
 * Si hay una versión mayor a la instalada, `electron-updater` la descarga en
 * segundo plano (en Windows/NSIS solo baja los bloques que cambiaron gracias al
 * .blockmap). Cuando termina, avisamos al usuario y ofrecemos reiniciar para
 * aplicar. Si dice "Más tarde", se instala sola al cerrar la app.
 *
 * Requisitos para que esto funcione en producción:
 *   1. Bloque "publish" en package.json (provider github, owner, repo).
 *   2. Publicar con `npm run release` (electron-builder --publish always).
 * En desarrollo (`npm start`) NO corre: no existe app-update.yml y daría error.
 */

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // vuelve a revisar cada hora

function setupAutoUpdate(getWindow) {
  let updateState = { status: 'idle', version: null, percent: 0, error: null };
  const publishState = (patch) => {
    updateState = { ...updateState, ...patch };
    getWindow()?.webContents.send('app-update:state', updateState);
  };

  ipcMain.handle('app-update:getState', () => updateState);
  ipcMain.handle('app-update:start', async () => {
    if (updateState.status !== 'available' && updateState.status !== 'error') return updateState;
    publishState({ status: 'downloading', percent: 0, error: null });
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      publishState({ status: 'error', error: err?.message || String(err) });
    }
    return updateState;
  });
  ipcMain.on('app-update:install', () => {
    if (updateState.status === 'ready') setImmediate(() => autoUpdater.quitAndInstall());
  });

  // En desarrollo no hay metadata de update; evitamos el error y salimos.
  if (!app.isPackaged) {
    console.log('[updater] modo desarrollo: auto-update desactivado.');
    return;
  }

  autoUpdater.autoDownload = false;         // espera la decisión del usuario en la tarjeta
  autoUpdater.autoInstallOnAppQuit = true;  // si no reinicia ahora, se aplica al cerrar

  autoUpdater.on('checking-for-update', () => console.log('[updater] buscando actualizaciones…'));

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] disponible: v${info.version}. Esperando confirmación…`);
    publishState({ status: 'available', version: info.version, percent: 0, error: null });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] ya estás en la última versión.');
    publishState({ status: 'idle', version: null, percent: 0, error: null });
  });

  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] ${Math.round(p.percent)}%`);
    publishState({ status: 'downloading', percent: Math.round(p.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] v${info.version} lista para instalar.`);
    publishState({ status: 'ready', version: info.version, percent: 100, error: null });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error al actualizar:', err?.message || err);
    if (updateState.status === 'downloading') publishState({ status: 'error', error: err?.message || String(err) });
  });

  const checkForUpdates = () => autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] no se pudo revisar actualizaciones:', err?.message || err);
  });

  checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}

module.exports = { setupAutoUpdate };
