const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  refresh: () => ipcRenderer.invoke('setup:refresh'),
  start: () => ipcRenderer.invoke('setup:start'),
  retry: (id) => ipcRenderer.invoke('setup:retry', id),
  openLog: () => ipcRenderer.invoke('setup:openLog'),
  onState: (cb) => ipcRenderer.on('setup:state', (_e, estado) => cb(estado)),
});
