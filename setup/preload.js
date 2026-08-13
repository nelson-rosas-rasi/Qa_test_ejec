const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  refresh: () => ipcRenderer.invoke('setup:refresh'),
  start: () => ipcRenderer.invoke('setup:start'),
  retry: (id) => ipcRenderer.invoke('setup:retry', id),
  skip: (id) => ipcRenderer.invoke('setup:skip', id),
  openLog: () => ipcRenderer.invoke('setup:openLog'),
  manual: (steps) => ipcRenderer.invoke('setup:manual', steps),
  onState: (cb) => ipcRenderer.on('setup:state', (_e, estado) => cb(estado)),
});
