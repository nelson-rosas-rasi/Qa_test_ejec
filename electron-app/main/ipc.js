const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, dialog } = require('electron');

const { appError } = require('./errors');
const { createConfigStore } = require('./config-store');
const { listProfiles } = require('./profiles');
const { createProjectManager, uniqueProjectId } = require('./projects');
const { locatePlaywrightCli } = require('./playwright/locate');
const { listTests } = require('./playwright/list-tests');
const { runTests } = require('./playwright/run-tests');

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
  const userData = app.getPath('userData');
  const store = createConfigStore(userData);
  const projects = createProjectManager({ projectsDir: path.join(userData, 'projects') });
  let currentRun = null;
  const showError = (err) => dialog.showErrorBox('QA Test Runner', err.message || String(err));
  const publicProject = ({ repoPath, dependencyLockHash, ...project }) => project;
  function ensureProject(projectId) {
    const project = store.getProject(projectId);
    if (!project.repoPath) throw appError('PROJECT_NOT_INITIALIZED', 'Inicializa un proyecto antes de continuar.');
    return { id: projectId, ...project };
  }
  async function ensureRepoPath(projectId) {
    const project = ensureProject(projectId);
    if (!fs.existsSync(project.repoPath)) throw appError('REPOSITORY_NOT_FOUND', 'No se encontró el repositorio local.');
    return project.repoPath;
  }

  /* ---------- proyectos ---------- */
  ipcMain.handle('projects:list', () => store.listProjects().filter((p) => p.repoPath && p.repoUrl && p.defaultBranch).map(publicProject));
  ipcMain.handle('projects:initialize', async (_event, input) => {
    try {
      const name = String(input?.name || '').trim();
      const repoUrl = String(input?.repoUrl || '').trim();
      const id = uniqueProjectId(name, new Set(store.listProjects().map((p) => p.id)));
      const project = await projects.initialize({ id, name, repoUrl });
      const { id: projectId, ...saved } = project;
      store.setProject(projectId, saved);
      return { ok: true, project: publicProject(project) };
    } catch (err) { return { ok: false, error: err.message || String(err), code: err.code }; }
  });
  ipcMain.handle('projects:importFolder', async () => {
    const answer = await dialog.showOpenDialog(getWindow(), {
      title: 'Elige una carpeta que ya tenga el repositorio clonado',
      properties: ['openDirectory'],
    });
    if (answer.canceled || !answer.filePaths[0]) return { ok: false, canceled: true };
    try {
      const sourcePath = answer.filePaths[0];
      const name = path.basename(sourcePath);
      const id = uniqueProjectId(name, new Set(store.listProjects().map((p) => p.id)));
      const project = await projects.importExisting({ id, sourcePath });
      const { id: projectId, ...saved } = project;
      store.setProject(projectId, saved);
      return { ok: true, project: publicProject(project) };
    } catch (err) { return { ok: false, error: err.message || String(err), code: err.code }; }
  });
  ipcMain.handle('projects:prepare', async (_event, projectId) => {
    try {
      const project = ensureProject(projectId);
      const update = await projects.prepare(project);
      store.setProject(projectId, update);
      return { ok: true, project: publicProject({ ...project, ...update }) };
    } catch (err) { return { ok: false, error: err.message || String(err), code: err.code }; }
  });

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
