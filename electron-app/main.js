const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 640,
    frame: false, // usamos una barra de título propia (ver renderer/index.html)
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Descomentar durante desarrollo:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ============================================================
   CONTROLES DE VENTANA (barra de título personalizada)
   ============================================================ */
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());

/* ============================================================
   PUNTOS DE INTEGRACIÓN REALES — reemplazar por la lógica real.
   Cada handler hoy devuelve datos simulados (mock) para que el
   frontend funcione de forma independiente mientras se conecta
   el backend real (git, Playwright, n8n).
   ============================================================ */

// 1) Árbol de pruebas: leer desde el repo local de Playwright
//    (p.ej. parseando `playwright test --list --reporter=json`)
ipcMain.handle('tests:getTree', async (_event, projectId) => {
  return require('./mock/tests-tree.json');
});

// 2) Estado de sincronización con git — comparar HEAD local vs remoto
ipcMain.handle('sync:checkStatus', async () => {
  return { updateAvailable: true, newTestsCount: 3, lastSyncedAt: Date.now() - 5 * 60_000 };
});

// 3) Actualizar (equivalente a git pull) — reportar progreso al renderer
ipcMain.handle('sync:update', async (event) => {
  const sender = event.sender;
  for (let p = 0; p <= 100; p += 20) {
    await new Promise((r) => setTimeout(r, 220));
    sender.send('sync:updateProgress', p);
  }
  return { ok: true };
});

// 4) Ejecutar pruebas: spawnear `npx playwright test` con los args según opciones
//    { testIds, visualMode, generateReport, stopOnFail }
//    Debe emitir eventos 'run:log' y 'run:testResult' por stdout parseado.
ipcMain.handle('run:start', async (event, payload) => {
  const sender = event.sender;
  const { testIds } = payload;
  for (const id of testIds) {
    sender.send('run:testResult', { id, status: 'running' });
    await new Promise((r) => setTimeout(r, 400));
    const passed = Math.random() > 0.15;
    sender.send('run:log', { level: passed ? 'pass' : 'fail', text: `Prueba ${id}` });
    sender.send('run:testResult', { id, status: passed ? 'passed' : 'failed' });
  }
  return { ok: true };
});

ipcMain.on('run:stop', () => {
  // TODO: matar el proceso hijo de Playwright en curso
});

// 5) Al finalizar la ejecución, disparar el webhook de n8n que genera el Word
ipcMain.handle('report:generate', async (_event, runId) => {
  // TODO: fetch(N8N_WEBHOOK_URL, { method: 'POST', body: JSON.stringify({ runId }) })
  return { docPath: `/reportes/Reporte-${runId}.docx` };
});

// 6) Historial de ejecuciones — leer de un archivo local o de la respuesta de n8n
ipcMain.handle('history:list', async () => {
  return require('./mock/history.json');
});
