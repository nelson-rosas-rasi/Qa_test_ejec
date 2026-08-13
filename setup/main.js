const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { detectPrerequisites } = require('./main/detect');
const { buildInstallers, OWNER, REPO } = require('./main/installers');
const { createRunner } = require('./main/run');
const { createLog } = require('./main/log');
const { lineaDeDeteccion, lineaDeEntorno } = require('./main/diagnostico');
const { guionManual } = require('./main/manual');
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
    // Toda la salida de los instaladores va también al registro: es lo que se
    // le pide al QA cuando algo falla y ya no depende de que copie la pantalla.
    onOutput: (linea) => log.write(`  ${linea}`),
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
  ipcMain.handle('setup:skip', (_e, id) => {
    log.write(`el QA salteó el paso: ${id}`);
    return runner.skip(id);
  });

  /**
   * Modo manual: escribe el guion en %TEMP% y abre una consola parada ahí, que
   * hereda el administrador que este proceso ya tiene. El setup no espera nada
   * de ella: el QA vuelve y toca Verificar.
   */
  ipcMain.handle('setup:manual', async (_e, steps) => {
    const temp = os.tmpdir();
    const guion = guionManual({
      steps: steps || [],
      temp,
      prerequisites,
      releasesUrl: `https://github.com/${OWNER}/${REPO}/releases`,
    });
    const archivo = path.join(temp, 'runqa-instalar-a-mano.cmd');
    try {
      // UTF-8 para que case con el `chcp 65001` del guion: una ruta con tilde
      // (C:\Users\José\...) escrita en otra página de códigos sale ilegible.
      fs.writeFileSync(archivo, guion, 'utf8');
      // `shell.openPath` (ShellExecute) y NO spawn con detached: en Windows
      // detached se traduce a DETACHED_PROCESS, que deja al hijo SIN consola
      // ninguna. Con stdio 'ignore' encima, el QA hacía clic y no pasaba nada.
      // ShellExecute abre la consola visible y hereda la elevación que este
      // proceso ya tiene. El guion termina en `cmd /K`, así que la ventana
      // queda abierta también si el QA lo abre con doble clic.
      const problema = await shell.openPath(archivo);
      if (problema) throw new Error(problema);
      log.write(`modo manual abierto: ${archivo}`);
      return { ok: true, archivo };
    } catch (err) {
      log.write(`no se pudo abrir el modo manual: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('setup:openLog', () => shell.openPath(log.file));

  crearVentana();
});

app.on('window-all-closed', () => app.quit());
