const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('info'),
  history: (sec) => ipcRenderer.invoke('history', sec),
  onStats: (cb) => ipcRenderer.on('stats', (e, s) => cb(s)),
  onError: (cb) => ipcRenderer.on('stats-error', (e, m) => cb(m)),
});
