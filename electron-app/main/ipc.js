const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, dialog, safeStorage, shell } = require('electron');

const { appError } = require('./errors');
const { createConfigStore } = require('./config-store');
const { readSchema, readExistingProfiles } = require('./profiles');
const { createProfileStore } = require('./profiles/store');
const { canRemoveProfile, nextActiveAfterSave } = require('./profiles/decide');
const { withProjectN8n } = require('./profiles/n8n-env');
const { writeEnv, sweep } = require('./profiles/materialize');
const { createProjectManager, uniqueProjectId } = require('./projects');
const { locatePlaywrightCli } = require('./playwright/locate');
const { listTests } = require('./playwright/list-tests');
const { runTests } = require('./playwright/run-tests');
const { createResultsStore, deriveMode } = require('./results/store');
const { testHistory } = require('./results/metrics');
const { notifyN8n } = require('./results/notify-n8n');
const { buildReportTokens, reportFileName } = require('./results/report-data');
const { fillTemplate, logoHtml } = require('./results/report-html');
const { renderPdf } = require('./results/report-pdf');
const { createRecordingsStore } = require('./recordings/store');
const { detectBaseUrl, recordingRepoPath, sanitizeBranch } = require('./recordings/detect');
const { record } = require('./recordings/codegen');
const { createRecordingsUploader } = require('./recordings/upload');
const { createAccountStore } = require('./github/account');
const { createGitAuth } = require('./github/git-auth');
const { requestDeviceCode, pollForToken } = require('./github/device-flow');
const { fetchIdentity } = require('./github/identity');
const { readGithubConfig } = require('./github/config');

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
  reporters.push('html');
  return reporters;
}

function registerIpc(getWindow) {
  const userData = app.getPath('userData');
  const store = createConfigStore(userData);
  // safeStorage sólo funciona tras app.whenReady(); registerIpc ya se llama ahí.
  const account = createAccountStore({ store, safeStorage });
  const auth = createGitAuth(() => account.load()?.token || null);
  const projects = createProjectManager({ projectsDir: path.join(userData, 'projects'), auth });
  const profileStore = createProfileStore({ dir: path.join(userData, 'perfiles'), safeStorage });
  const resultsStore = createResultsStore({ dir: path.join(userData, 'results') });
  const recordingsStore = createRecordingsStore({ dir: path.join(userData, 'grabaciones') });
  const uploader = createRecordingsUploader({ baseDir: path.join(userData, 'grabaciones-git'), auth });

  /** Escribe en el clon el .env del perfil activo del proyecto (o solo barre si no hay). */
  function materializeActive(projectId) {
    const project = store.getProject(projectId);
    if (!project.repoPath || !fs.existsSync(project.repoPath)) return;
    sweep(project.repoPath);
    const values = project.profile ? profileStore.load(projectId, project.profile) : null;
    // La URL de n8n es del proyecto (compartida por todos los perfiles): se inyecta aquí.
    if (values) writeEnv({ repoPath: project.repoPath, id: project.profile, values: withProjectN8n(values, project.n8nWebhookUrl) });
  }

  /** Al arrancar y al cerrar: barre restos de .env en claro de todos los clones. */
  function sweepAll() {
    for (const project of store.listProjects()) {
      if (project.repoPath && fs.existsSync(project.repoPath)) sweep(project.repoPath);
    }
  }

  sweepAll();                         // limpia restos de una sesión que murió mal
  app.on('before-quit', sweepAll);    // limpia al salir

  let currentRun = null;
  let lastRun = null;
  let currentDeviceFlow = null;
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

  /** URL de n8n: ajuste de proyecto, compartido por todos los perfiles. */
  function resolveN8nUrl(projectId) {
    return store.getProject(projectId).n8nWebhookUrl || null;
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
      const existingProfiles = readExistingProfiles(sourcePath);
      const project = await projects.importExisting({ id, sourcePath });
      const { id: projectId, ...saved } = project;
      for (const profile of existingProfiles) {
        profileStore.save(projectId, profile.id, profile.values);
      }
      store.setProject(projectId, {
        ...saved,
        ...(existingProfiles[0] ? { profile: existingProfiles[0].id } : {}),
      });
      materializeActive(projectId);
      return { ok: true, project: publicProject(project), importedProfiles: existingProfiles.length };
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

  /* ---------- cuenta de GitHub ---------- */
  ipcMain.handle('github:status', async () => {
    const saved = account.load();
    if (!saved) return { connected: false };
    try {
      const identity = await fetchIdentity({ token: saved.token });
      account.saveIdentity(identity);
      return { connected: true, ...identity };
    } catch (err) {
      if (err.code === 'GITHUB_TOKEN_INVALID') {
        account.clear();
        return { connected: false, reason: 'EXPIRED' };
      }
      // Sin red: sigue conectada, con lo último que supimos de ella.
      return { connected: true, ...(saved.identity || {}), stale: true };
    }
  });

  ipcMain.handle('github:connect', async (event) => {
    const { clientId, scope } = readGithubConfig();
    if (!clientId) {
      return { ok: false, code: 'GITHUB_NOT_CONFIGURED', error: 'La app todavía no tiene configurada la conexión con GitHub. Avisa al equipo.' };
    }
    if (currentDeviceFlow) {
      return { ok: false, code: 'GITHUB_CONNECT_IN_PROGRESS', error: 'Ya hay una conexión en curso.' };
    }
    const controller = new AbortController();
    currentDeviceFlow = controller;
    try {
      const device = await requestDeviceCode({ clientId, scope });
      event.sender.send('github:deviceCode', { userCode: device.userCode, verificationUri: device.verificationUri });
      await shell.openExternal(device.verificationUri);
      const token = await pollForToken({
        clientId,
        deviceCode: device.deviceCode,
        interval: device.interval,
        expiresIn: device.expiresIn,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        signal: controller.signal,
      });
      const identity = await fetchIdentity({ token });
      account.save(token, identity);
      return { ok: true, account: identity };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    } finally {
      currentDeviceFlow = null;
    }
  });

  ipcMain.handle('github:cancelConnect', () => {
    currentDeviceFlow?.abort();
    return { ok: true };
  });

  ipcMain.handle('github:disconnect', () => {
    account.clear();
    return { ok: true };
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
  ipcMain.handle('profiles:list', (_event, projectId) => profileStore.list(projectId));

  ipcMain.handle('profiles:schema', async (_event, projectId) => {
    try {
      return { ok: true, fields: readSchema(await ensureRepoPath(projectId)) };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    }
  });

  ipcMain.handle('profiles:get', (_event, projectId, id) => {
    const values = profileStore.load(projectId, id);
    if (!values) return { ok: false, code: 'PROFILE_NOT_FOUND', error: 'No se pudo cargar el perfil.' };
    return { ok: true, values };
  });

  ipcMain.handle('profiles:save', (_event, projectId, id, values) => {
    try {
      const isNew = !id;
      const finalId = id || uniqueProjectId(values.QA_NOMBRE || 'perfil', new Set(profileStore.list(projectId).map((p) => p.id)));
      profileStore.save(projectId, finalId, values);
      const currentActive = store.getProject(projectId).profile || null;
      const active = nextActiveAfterSave({ isNew, currentActive, savedId: finalId });
      store.setProject(projectId, { profile: active });
      if (active === finalId) materializeActive(projectId);
      return { ok: true, profile: { id: finalId, name: values.QA_NOMBRE || finalId, role: values.QA_CARGO || 'QA' } };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    }
  });

  ipcMain.handle('profiles:remove', (_event, projectId, id) => {
    const active = store.getProject(projectId).profile || null;
    if (!canRemoveProfile(active, id)) {
      return { ok: false, code: 'PROFILE_ACTIVE', error: 'Activa otro perfil primero para poder eliminar este.' };
    }
    profileStore.remove(projectId, id);
    return { ok: true };
  });

  ipcMain.handle('profiles:active', (_event, projectId) => store.getProject(projectId).profile || null);

  ipcMain.handle('profiles:select', (_event, projectId, profileId) => {
    store.setProject(projectId, { profile: profileId });
    materializeActive(projectId);
    return profileId;
  });

  /* ---------- configuración del proyecto ---------- */
  ipcMain.handle('config:get', (_event, projectId) => {
    const project = store.getProject(projectId);
    return {
      n8nWebhookUrl: project.n8nWebhookUrl || '',
      hasRepo: !!(project.repoPath && fs.existsSync(project.repoPath)),
    };
  });

  ipcMain.handle('config:setN8n', (_event, projectId, url) => {
    const value = String(url || '').trim();
    store.setProject(projectId, { n8nWebhookUrl: value });
    return { ok: true, n8nWebhookUrl: value };
  });

  ipcMain.handle('projects:openFolder', async (_event, projectId) => {
    const project = store.getProject(projectId);
    if (!project.repoPath || !fs.existsSync(project.repoPath)) {
      return { ok: false, error: 'No se encontró la carpeta del repositorio.' };
    }
    const err = await shell.openPath(project.repoPath);
    return err ? { ok: false, error: err } : { ok: true };
  });

  /* ---------- ejecución ---------- */
  ipcMain.handle('run:start', async (event, payload) => {
    const { projectId = 'erp', testIds = [], runAll = false, visualMode = false, stopOnFail = false } = payload || {};
    const empty = { ok: false, stopped: false, summary: { passed: 0, failed: 0, skipped: 0, durationMs: 0 } };
    const runId = 'run-' + Date.now();
    const startedAt = new Date().toISOString();
    try {
      const repoPath = await ensureRepoPath(projectId);
      materializeActive(projectId);   // asegura el .env del perfil activo antes de correr
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
      const outcome = await currentRun.promise;
      const project = store.getProject(projectId);
      const values = project.profile ? profileStore.load(projectId, project.profile) : null;
      lastRun = {
        id: runId,
        projectId, projectName: project.name || projectId,
        profileId: project.profile || null,
        profileName: (values && values.QA_NOMBRE) || project.profile || null,
        startedAt, finishedAt: new Date().toISOString(),
        durationMs: outcome.summary.durationMs,
        mode: deriveMode(testIds, runAll),
        runAll,
        options: { visualMode, stopOnFail },
        summary: {
          total: outcome.tests.length,
          passed: outcome.summary.passed,
          failed: outcome.summary.failed,
          skipped: outcome.summary.skipped,
        },
        tests: outcome.tests,
        report: null,
        n8n: { sent: false, at: null, ok: null, error: null },
      };
      return { ...outcome, summary: lastRun.summary, runId };
    } catch (err) {
      showError(err);
      return empty;
    } finally {
      currentRun = null;
    }
  });

  ipcMain.on('run:stop', () => currentRun?.stop());

  /* ---------- sincronización de pruebas (git) ---------- */
  /** Verifica, repo por repo, si hay pruebas nuevas/refinadas por traer del remoto. */
  ipcMain.handle('sync:reposStatus', async () => {
    const results = [];
    for (const project of store.listProjects()) {
      if (!project.repoPath || !project.repoUrl || !project.defaultBranch) continue;
      const base = { id: project.id, name: project.name };
      try {
        results.push({ ...base, ...(await projects.checkStatus(project)) });
      } catch (err) {
        results.push({ ...base, error: err.message || String(err), code: err.code });
      }
    }
    return results;
  });

  /* ---------- resultados guardados ---------- */
  ipcMain.handle('results:save', async (_event, runId, opts) => {
    const { toN8n = false } = opts || {};
    if (!lastRun || lastRun.id !== runId) {
      return { ok: false, code: 'RUN_EXPIRED', error: 'Esta corrida ya no está disponible para guardar.' };
    }
    const record = { ...lastRun };
    record.report = null;
    record.reportPlaywright = null;
    // 1) Reporte visual de Playwright (secundario, con traces/screenshots).
    try {
      const repoPath = await ensureRepoPath(record.projectId);
      const src = path.join(repoPath, 'playwright-report');
      if (fs.existsSync(src)) {
        const dest = resultsStore.reportDir(record.projectId, record.id);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(src, dest, { recursive: true });
        record.reportPlaywright = { path: `${record.id}/report` };
      }
    } catch { record.reportPlaywright = null; }
    // 2) Reporte principal: PDF con la plantilla RASI, desde los datos de la corrida.
    try {
      const profileValues = record.profileId ? profileStore.load(record.projectId, record.profileId) : null;
      const template = fs.readFileSync(path.join(__dirname, 'results', 'report-template.html'), 'utf8');
      const html = fillTemplate(template, { ...buildReportTokens(record, profileValues), LOGO: logoHtml() });
      const pdfName = reportFileName(record.finishedAt);
      const htmlPath = resultsStore.reportHtml(record.projectId, record.id);
      const pdfPath = resultsStore.reportPdf(record.projectId, record.id, pdfName);
      fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
      await renderPdf({ html, htmlPath, pdfPath });
      record.report = { kind: 'template-pdf', path: `${record.id}/${pdfName}` };
    } catch { record.report = null; }
    let n8nSkipped = false;
    if (toN8n) {
      const url = resolveN8nUrl(record.projectId);
      if (url) {
        const res = await notifyN8n(record, { url });
        record.n8n = { sent: true, at: res.at, ok: res.ok, error: res.error };
      } else {
        n8nSkipped = true;   // pidió documentación pero no hay URL: se guarda local igual
      }
    }
    resultsStore.save(record);
    return { ok: true, record, n8nSkipped };
  });

  ipcMain.handle('results:list', (_event, projectId) => resultsStore.list(projectId));
  ipcMain.handle('results:get', (_event, projectId, runId) => resultsStore.get(projectId, runId));
  ipcMain.handle('results:remove', (_event, projectId, runId) => {
    resultsStore.remove(projectId, runId);
    return { ok: true };
  });

  ipcMain.handle('results:metrics', (_event, projectId, testIds) => {
    const records = resultsStore.list(projectId);
    const out = {};
    for (const id of testIds || []) out[id] = testHistory(records, id);
    return out;
  });

  ipcMain.handle('results:resendN8n', async (_event, projectId, runId) => {
    const record = resultsStore.get(projectId, runId);
    if (!record) return { ok: false, code: 'RESULT_NOT_FOUND', error: 'No se encontró la corrida.' };
    const url = resolveN8nUrl(projectId);
    if (!url) return { ok: false, code: 'N8N_NOT_CONFIGURED', error: 'Configura la dirección para generar la documentación.' };
    const res = await notifyN8n(record, { url });
    record.n8n = { sent: true, at: res.at, ok: res.ok, error: res.error };
    resultsStore.save(record);
    return { ok: res.ok, n8n: record.n8n };
  });

  ipcMain.handle('results:openReport', async (_event, projectId, runId) => {
    const rec = resultsStore.get(projectId, runId);
    const name = rec && rec.report && rec.report.kind === 'template-pdf' ? path.basename(rec.report.path) : 'reporte.pdf';
    const pdf = resultsStore.reportPdf(projectId, runId, name);
    if (!fs.existsSync(pdf)) return { ok: false, error: 'El reporte no está disponible.' };
    const err = await shell.openPath(pdf);
    return err ? { ok: false, error: err } : { ok: true };
  });

  ipcMain.handle('results:openPlaywright', async (_event, projectId, runId) => {
    const index = resultsStore.reportIndex(projectId, runId);
    if (!fs.existsSync(index)) return { ok: false, error: 'El reporte de Playwright no está disponible.' };
    const err = await shell.openPath(index);
    return err ? { ok: false, error: err } : { ok: true };
  });

  ipcMain.handle('results:openFolder', async (_event, projectId, runId) => {
    const runDir = resultsStore.runDir(projectId, runId);
    const target = fs.existsSync(runDir) ? runDir : path.join(userData, 'results', projectId);
    const err = await shell.openPath(target);
    return err ? { ok: false, error: err } : { ok: true };
  });

  /* ---------- grabaciones ---------- */
  ipcMain.handle('recordings:list', (_event, projectId) => recordingsStore.list(projectId).map((meta) => {
    // Los perfiles antiguos podían conservar un id creado desde el texto de la
    // plantilla (p. ej. `tu-nombre-completo`) aunque QA_NOMBRE ya hubiera sido
    // corregido. Para mostrar al QA usamos siempre el nombre actual del perfil.
    const values = meta.profileId ? profileStore.load(projectId, meta.profileId) : null;
    return { ...meta, profileName: (values && values.QA_NOMBRE) || meta.profileName || meta.profileId || null };
  }));

  ipcMain.handle('recordings:baseUrl', (_event, projectId) => {
    const project = store.getProject(projectId);
    const values = project.profile ? profileStore.load(projectId, project.profile) : null;
    return detectBaseUrl(values);
  });

  ipcMain.handle('recordings:record', async (_event, projectId, opts) => {
    const { url = '', name = '' } = opts || {};
    try {
      const project = ensureProject(projectId);
      const profileId = project.profile || null;
      if (!profileId) return { ok: false, code: 'PROFILE_REQUIRED', error: 'Selecciona un perfil antes de iniciar la grabación.' };
      const profileValues = profileStore.load(projectId, profileId);
      const profileName = (profileValues && profileValues.QA_NOMBRE) || profileId;
      const repoPath = await ensureRepoPath(projectId);
      const id = 'grab-' + Date.now();
      const specPath = recordingsStore.specFile(projectId, id);
      fs.mkdirSync(path.dirname(specPath), { recursive: true });
      const res = await record({ cliPath: locatePlaywrightCli(repoPath), repoPath, url: String(url).trim(), outFile: specPath });
      if (!res.ok || !fs.existsSync(specPath)) {
        fs.rmSync(specPath, { force: true });
        return { ok: false, error: 'No se grabó nada. Haz el flujo y cierra el grabador para guardarlo.' };
      }
      const finalName = String(name).trim() || `Grabación ${new Date().toLocaleString('es-CO')}`;
      return { ok: true, recording: recordingsStore.saveMeta(projectId, id, finalName, profileId, profileName) };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    }
  });

  ipcMain.handle('recordings:rename', (_event, projectId, id, name) => {
    const finalName = String(name || '').trim();
    if (!finalName) return { ok: false, error: 'Escribe un nombre para la grabación.' };
    const meta = recordingsStore.rename(projectId, id, finalName);
    return meta ? { ok: true, recording: meta } : { ok: false, error: 'No se encontró la grabación.' };
  });

  ipcMain.handle('recordings:remove', (_event, projectId, id) => {
    recordingsStore.remove(projectId, id);
    return { ok: true };
  });

  ipcMain.handle('recordings:branches', async (_event, projectId) => {
    try {
      const project = ensureProject(projectId);
      return { ok: true, branches: await uploader.listBranches(project) };
    } catch (err) {
      return { ok: false, error: (err.stderr && String(err.stderr).trim()) || err.message || String(err), code: err.code };
    }
  });

  ipcMain.handle('recordings:upload', async (_event, projectId, opts) => {
    const { id, branch, isNew = false } = opts || {};
    try {
      const project = ensureProject(projectId);
      if (!account.load()) return { ok: false, code: 'GITHUB_REQUIRED', error: 'Conecta tu cuenta de GitHub para subir la grabación.' };
      const safeBranch = sanitizeBranch(branch);
      if (!safeBranch) return { ok: false, error: 'El nombre de la rama no es válido.' };
      const meta = recordingsStore.list(projectId).find((m) => m.id === id);
      if (!meta) return { ok: false, error: 'No se encontró la grabación.' };
      const draftPath = recordingsStore.specFile(projectId, id);
      // El perfil se captura al grabar, no al subir: cambiar de perfil después
      // no debe mover el draft a la carpeta de otro QA.
      const currentProfileValues = meta.profileId ? profileStore.load(projectId, meta.profileId) : null;
      const ownerName = (currentProfileValues && currentProfileValues.QA_NOMBRE) || meta.profileName || meta.profileId;
      const repoRelPath = recordingRepoPath(ownerName, meta.name);
      const identity = account.load()?.identity || null;
      await uploader.upload({ project, draftPath, repoRelPath, branch: safeBranch, isNew: !!isNew, message: `Draft: ${meta.name} (grabación RunQA)`, identity });
      return { ok: true, recording: recordingsStore.markUploaded(projectId, id, safeBranch), branch: safeBranch };
    } catch (err) {
      return { ok: false, error: (err.stderr && String(err.stderr).trim()) || err.message || String(err), code: err.code };
    }
  });
}

module.exports = { registerIpc };
