const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { detectPrerequisites } = require('./main/detect');
const { buildInstallers } = require('./main/installers');
const { createRunner } = require('./main/run');
const { createLog } = require('./main/log');
const prerequisites = require('./prerequisites.json');

let ventana = null;

function crearVentana() {
  ventana = new BrowserWindow({
    width: 620,
    height: 660,
    resizable: false,
    title: 'RunQA Setup',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  ventana.setMenuBarVisibility(false);
  ventana.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  const log = createLog(path.join(app.getPath('appData'), 'RunQA Setup'));
  const installers = buildInstallers({});
  let terminado = false;
  const runner = createRunner({
    detect: () => detectPrerequisites({
      playwrightVersion: prerequisites.playwright.version,
      // Los mínimos salen del mismo archivo que las descargas, para que subir la
      // versión fijada no deje el piso viejo escondido en el código.
      minimums: { git: prerequisites.git.minVersion, node: prerequisites.node.minVersion },
    }),
    installers,
    publish: (estado) => {
      if (estado.error) log.write(`error en ${estado.current || 'un paso'}: ${estado.error}`);
      terminado = estado.steps.length > 0 && estado.steps.every((paso) => paso.status === 'done');
      ventana?.webContents.send('setup:state', estado);
    },
  });

  ipcMain.handle('setup:refresh', () => runner.refresh());
  ipcMain.handle('setup:start', async () => {
    await runner.start();
    // El último paso espera a que el asistente de RunQA termine. Si llegó hasta
    // ahí, el setup ya cumplió su función y se va.
    if (terminado) app.quit();
  });
  ipcMain.handle('setup:retry', (_e, id) => runner.retry(id));
  ipcMain.handle('setup:openLog', () => shell.openPath(log.file));

  crearVentana();
});

app.on('window-all-closed', () => app.quit());
