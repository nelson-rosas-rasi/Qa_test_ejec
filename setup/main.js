const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { detectPrerequisites } = require('./main/detect');
const { buildInstallers } = require('./main/installers');
const { createRunner } = require('./main/run');
const { createLog } = require('./main/log');
const { lineaDeDeteccion, lineaDeEntorno } = require('./main/diagnostico');
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
  // Con qué cuenta corre decide cómo se lee todo lo demás: elevar con
  // credenciales ajenas cambia %ProgramFiles%, el PATH y %TEMP% que ve la
  // detección. Va una sola vez, al abrir.
  let usuario = null;
  try { usuario = os.userInfo().username; } catch { usuario = null; }
  log.write(lineaDeEntorno({ version: app.getVersion(), usuario, temp: os.tmpdir() }));
  const runner = createRunner({
    // Cada vistazo al equipo queda registrado, no sólo los errores: sin esto un
    // fallo del instalador no permite saber si el prerequisito ya estaba.
    detect: async () => {
      const estado = await detectPrerequisites({
        playwrightVersion: prerequisites.playwright.version,
        // Los mínimos salen del mismo archivo que las descargas, para que subir la
        // versión fijada no deje el piso viejo escondido en el código.
        minimums: { git: prerequisites.git.minVersion, node: prerequisites.node.minVersion },
      });
      log.write(lineaDeDeteccion(estado));
      return estado;
    },
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
