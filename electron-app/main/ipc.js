const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, dialog } = require('electron');

const { appError } = require('./errors');
const { createConfigStore } = require('./config-store');
const { listProfiles } = require('./profiles');
const { locatePlaywrightCli } = require('./playwright/locate');
const { listTests } = require('./playwright/list-tests');
const { runTests } = require('./playwright/run-tests');

const PROJECT_LABELS = { erp: 'ERP', medical: 'Medical', finance: 'Finanzas' };

/** Empaquetado: el reporter debe vivir fuera de app.asar para que Playwright pueda leerlo. */
function reporterPath() {
  const base = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked');
  return path.join(base, 'main', 'playwright', 'ndjson-reporter.cjs');
}

/** El reporter del repo (si lo tiene) sigue escribiendo .last-test-results.json para n8n. */
function reportersFor(repoPath) {
  const reporters = [];
  if (fs.existsSync(path.join(repoPath, 'json-reporter.cjs'))) reporters.push('./json-reporter.cjs');
  reporters.push(reporterPath());
  return reporters;
}

function registerIpc(getWindow) {
  const store = createConfigStore(app.getPath('userData'));
  let currentRun = null;

  const showError = (err) => dialog.showErrorBox('QA Test Runner', err.message || String(err));

  async function ensureRepoPath(projectId) {
    const saved = store.getProject(projectId).repoPath;
    if (saved && fs.existsSync(saved)) return saved;

    const answer = await dialog.showOpenDialog(getWindow(), {
      title: `Elige la carpeta del proyecto ${PROJECT_LABELS[projectId] || projectId}`,
      properties: ['openDirectory'],
    });
    if (answer.canceled || !answer.filePaths[0]) {
      throw appError('REPO_NOT_CONFIGURED', 'No elegiste una carpeta para este proyecto.');
    }
    store.setProject(projectId, { repoPath: answer.filePaths[0] });
    return answer.filePaths[0];
  }

  /* ---------- ventana ---------- */
  ipcMain.on('window:minimize', () => getWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => getWindow()?.close());

  /* ---------- pruebas ---------- */
  ipcMain.handle('tests:getTree', async (_event, projectId) => {
    try {
      const repoPath = await ensureRepoPath(projectId);
      return await listTests({ repoPath, cliPath: locatePlaywrightCli(repoPath) });
    } catch (err) {
      showError(err);
      return [];
    }
  });

  /* ---------- perfiles ---------- */
  ipcMain.handle('profiles:list', async (_event, projectId) => {
    try {
      return listProfiles(await ensureRepoPath(projectId));
    } catch (err) {
      showError(err);
      return [];
    }
  });

  ipcMain.handle('profiles:active', (_event, projectId) => store.getProject(projectId).profile || null);

  ipcMain.handle('profiles:select', (_event, projectId, profileId) => {
    store.setProject(projectId, { profile: profileId });
    return profileId;
  });

  /* ---------- ejecución ---------- */
  ipcMain.handle('run:start', async (event, payload) => {
    const { projectId = 'erp', testIds = [], runAll = false, visualMode = false, stopOnFail = false } = payload || {};
    const empty = { ok: false, stopped: false, summary: { passed: 0, failed: 0, skipped: 0, durationMs: 0 } };
    try {
      const repoPath = await ensureRepoPath(projectId);
      currentRun = runTests(
        {
          repoPath,
          cliPath: locatePlaywrightCli(repoPath),
          reporters: reportersFor(repoPath),
          profile: store.getProject(projectId).profile,
          testIds, runAll, visualMode, stopOnFail,
        },
        (ipcEvent) => event.sender.send(ipcEvent.channel, ipcEvent.payload),
      );
      return await currentRun.promise;
    } catch (err) {
      showError(err);
      return empty;
    } finally {
      currentRun = null;
    }
  });

  ipcMain.on('run:stop', () => currentRun?.stop());

  /* ---------- todavía simulados (rebanadas siguientes) ---------- */
  ipcMain.handle('sync:checkStatus', async () => ({
    updateAvailable: true,
    newTestsCount: 3,
    lastSyncedAt: Date.now() - 5 * 60_000,
  }));

  ipcMain.handle('sync:update', async (event) => {
    for (let pct = 0; pct <= 100; pct += 20) {
      await new Promise((resolve) => setTimeout(resolve, 220));
      event.sender.send('sync:updateProgress', pct);
    }
    return { ok: true };
  });

  ipcMain.handle('report:generate', async (_event, runId) => ({ docPath: `/reportes/Reporte-${runId}.docx` }));

  ipcMain.handle('history:list', async () => require('../mock/history.json'));
}

module.exports = { registerIpc };
