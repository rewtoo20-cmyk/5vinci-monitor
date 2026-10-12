const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('info'),
  history: (sec) => ipcRenderer.invoke('history', sec),
  onStats: (cb) => ipcRenderer.on('stats', (e, s) => cb(s)),
  opt: {
    catalog: () => ipcRenderer.invoke('opt:catalog'),
    apply: (id) => ipcRenderer.invoke('opt:apply', id),
    revert: (id) => ipcRenderer.invoke('opt:revert', id),
    log: () => ipcRenderer.invoke('opt:log'),
    startup: () => ipcRenderer.invoke('opt:startup'),
    startupSet: (id, en) => ipcRenderer.invoke('opt:startupSet', id, en),
    cleanScan: () => ipcRenderer.invoke('opt:cleanScan'),
    cleanRun: (ids, bytes) => ipcRenderer.invoke('opt:cleanRun', ids, bytes),
    restorePoint: () => ipcRenderer.invoke('opt:restorePoint'),
    kill: (pid, name) => ipcRenderer.invoke('opt:kill', pid, name),
  },
  onError: (cb) => ipcRenderer.on('stats-error', (e, m) => cb(m)),
});
