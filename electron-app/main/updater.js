const { app, dialog, Notification } = require('electron');
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
  // En desarrollo no hay metadata de update; evitamos el error y salimos.
  if (!app.isPackaged) {
    console.log('[updater] modo desarrollo: auto-update desactivado.');
    return;
  }

  autoUpdater.autoDownload = true;          // descarga sola al detectar versión nueva
  autoUpdater.autoInstallOnAppQuit = true;  // si no reinicia ahora, se aplica al cerrar

  autoUpdater.on('checking-for-update', () => console.log('[updater] buscando actualizaciones…'));

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] disponible: v${info.version}. Descargando…`);
    if (Notification.isSupported()) {
      new Notification({
        title: 'RunQA — actualización disponible',
        body: `Descargando la versión ${info.version} en segundo plano…`,
      }).show();
    }
  });

  autoUpdater.on('update-not-available', () => console.log('[updater] ya estás en la última versión.'));

  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] ${Math.round(p.percent)}%`);
    // Opcional: reflejarlo en la UI del renderer.
    getWindow()?.webContents.send('app-update:progress', Math.round(p.percent));
  });

  autoUpdater.on('update-downloaded', async (info) => {
    console.log(`[updater] v${info.version} lista para instalar.`);
    const win = getWindow();
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
      title: 'Actualización disponible',
      message: `RunQA ${info.version} ya está lista.`,
      detail: 'La aplicación se reiniciará para aplicar la actualización. Si eliges "Más tarde", se instalará automáticamente la próxima vez que cierres RunQA.',
    });
    if (response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error al actualizar:', err?.message || err);
  });

  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
}

module.exports = { setupAutoUpdate };
