const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qa', {
  // ventana
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  // proyectos
  listProjects: () => ipcRenderer.invoke('projects:list'),
  initializeProject: (input) => ipcRenderer.invoke('projects:initialize', input),
  importProjectFolder: () => ipcRenderer.invoke('projects:importFolder'),
  prepareProject: (projectId) => ipcRenderer.invoke('projects:prepare', projectId),

  // datos
  getTestTree: (projectId) => ipcRenderer.invoke('tests:getTree', projectId),
  checkSyncStatus: () => ipcRenderer.invoke('sync:checkStatus'),
  runUpdate: () => ipcRenderer.invoke('sync:update'),
  onUpdateProgress: (cb) => ipcRenderer.on('sync:updateProgress', (_e, pct) => cb(pct)),

  // perfiles de QA
  listProfiles: (projectId) => ipcRenderer.invoke('profiles:list', projectId),
  getActiveProfile: (projectId) => ipcRenderer.invoke('profiles:active', projectId),
  selectProfile: (projectId, profileId) => ipcRenderer.invoke('profiles:select', projectId, profileId),

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

  generateReport: (runId) => ipcRenderer.invoke('report:generate', runId),
  getHistory: () => ipcRenderer.invoke('history:list'),
});
