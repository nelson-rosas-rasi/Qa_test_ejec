const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qa', {
  // ventana
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  // aplicación y actualizaciones
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getUpdateState: () => ipcRenderer.invoke('app-update:getState'),
  startUpdate: () => ipcRenderer.invoke('app-update:start'),
  installUpdate: () => ipcRenderer.send('app-update:install'),
  onUpdateState: (cb) => ipcRenderer.on('app-update:state', (_e, state) => cb(state)),

  // proyectos
  listProjects: () => ipcRenderer.invoke('projects:list'),
  initializeProject: (input) => ipcRenderer.invoke('projects:initialize', input),
  importProjectFolder: () => ipcRenderer.invoke('projects:importFolder'),
  prepareProject: (projectId) => ipcRenderer.invoke('projects:prepare', projectId),
  projectRemovalSummary: (projectId) => ipcRenderer.invoke('projects:removalSummary', projectId),
  removeProject: (projectId, opts) => ipcRenderer.invoke('projects:remove', projectId, opts),

  // datos
  getTestTree: (projectId) => ipcRenderer.invoke('tests:getTree', projectId),
  // estado de sincronización de las pruebas por repositorio (git fetch + compara);
  // el pull real de cada repo se hace con prepareProject.
  reposStatus: () => ipcRenderer.invoke('sync:reposStatus'),

  // perfiles de QA
  listProfiles: (projectId) => ipcRenderer.invoke('profiles:list', projectId),
  getActiveProfile: (projectId) => ipcRenderer.invoke('profiles:active', projectId),
  selectProfile: (projectId, profileId) => ipcRenderer.invoke('profiles:select', projectId, profileId),
  getProfileSchema: (projectId) => ipcRenderer.invoke('profiles:schema', projectId),
  saveProfile: (projectId, id, values) => ipcRenderer.invoke('profiles:save', projectId, id, values),
  getProfile: (projectId, id) => ipcRenderer.invoke('profiles:get', projectId, id),
  removeProfile: (projectId, id) => ipcRenderer.invoke('profiles:remove', projectId, id),

  // cuenta de GitHub
  getGithubStatus: () => ipcRenderer.invoke('github:status'),
  connectGithub: () => ipcRenderer.invoke('github:connect'),
  cancelGithubConnect: () => ipcRenderer.invoke('github:cancelConnect'),
  disconnectGithub: () => ipcRenderer.invoke('github:disconnect'),
  onGithubDeviceCode: (cb) => ipcRenderer.on('github:deviceCode', (_e, data) => cb(data)),

  startRun: (payload) => ipcRenderer.invoke('run:start', payload),
  stopRun: () => ipcRenderer.send('run:stop'),
  onRunLog: (cb) => ipcRenderer.on('run:log', (_e, entry) => cb(entry)),
  onTestResult: (cb) => ipcRenderer.on('run:testResult', (_e, entry) => cb(entry)),

  // configuración del proyecto
  getProjectConfig: (projectId) => ipcRenderer.invoke('config:get', projectId),
  setN8nUrl: (projectId, url) => ipcRenderer.invoke('config:setN8n', projectId, url),
  openProjectFolder: (projectId) => ipcRenderer.invoke('projects:openFolder', projectId),
  getProjectsRoot: () => ipcRenderer.invoke('config:getProjectsRoot'),
  chooseProjectsRoot: () => ipcRenderer.invoke('config:chooseProjectsRoot'),

  // grabaciones
  listRecordings: (projectId) => ipcRenderer.invoke('recordings:list', projectId),
  recordingBaseUrl: (projectId) => ipcRenderer.invoke('recordings:baseUrl', projectId),
  recordFlow: (projectId, opts) => ipcRenderer.invoke('recordings:record', projectId, opts),
  renameRecording: (projectId, id, name) => ipcRenderer.invoke('recordings:rename', projectId, id, name),
  removeRecording: (projectId, id) => ipcRenderer.invoke('recordings:remove', projectId, id),
  recordingBranches: (projectId) => ipcRenderer.invoke('recordings:branches', projectId),
  uploadRecording: (projectId, opts) => ipcRenderer.invoke('recordings:upload', projectId, opts),

  // resultados guardados
  saveResults: (runId, opts) => ipcRenderer.invoke('results:save', runId, opts),
  listResults: (projectId) => ipcRenderer.invoke('results:list', projectId),
  getResult: (projectId, runId) => ipcRenderer.invoke('results:get', projectId, runId),
  removeResult: (projectId, runId) => ipcRenderer.invoke('results:remove', projectId, runId),
  resultsMetrics: (projectId, testIds) => ipcRenderer.invoke('results:metrics', projectId, testIds),
  resendResultN8n: (projectId, runId) => ipcRenderer.invoke('results:resendN8n', projectId, runId),
  openResultReport: (projectId, runId) => ipcRenderer.invoke('results:openReport', projectId, runId),
  openResultPlaywright: (projectId, runId) => ipcRenderer.invoke('results:openPlaywright', projectId, runId),
  openResultFolder: (projectId, runId) => ipcRenderer.invoke('results:openFolder', projectId, runId),

  // sesión del backend
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  logout: () => ipcRenderer.invoke('auth:logout'),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  listAssignments: (range) => ipcRenderer.invoke('assignments:list', range),
  listNotifications: (options) => ipcRenderer.invoke('notifications:list', options),
  markNotificationRead: (id) => ipcRenderer.invoke('notifications:read', id),
  markAllNotificationsRead: () => ipcRenderer.invoke('notifications:readAll'),
  onOpenAssignmentDate: (callback) => ipcRenderer.on('assignments:openDate', (_event, targetDate) => callback(targetDate)),
  getServerUrl: () => ipcRenderer.invoke('config:getServerUrl'),
  setServerUrl: (url) => ipcRenderer.invoke('config:setServerUrl', url),
  discardResult: (runId) => ipcRenderer.invoke('results:discard', runId),
  onServerPending: (cb) => ipcRenderer.on('server:pending', (_e, n) => cb(n)),
});
