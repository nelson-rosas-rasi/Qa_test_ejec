const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { registerIpc } = require('./main/ipc');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 640,
    icon: path.join(__dirname, 'renderer', 'assets', 'runqa-icon.png'),
    frame: false, // usamos una barra de título propia (ver renderer/index.html)
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.setAppUserModelId('com.tuempresa.qatestrunner');

app.whenReady().then(() => {
  registerIpc(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
