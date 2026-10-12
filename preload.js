const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  info: () => inv('info'),
  history: (sec) => inv('history', sec),
  page: (p) => inv('ui:page', String(p).slice(0, 20)),
  onStats: (cb) => ipcRenderer.on('stats', (e, s) => cb(s)),
  onError: (cb) => ipcRenderer.on('stats-error', (e, m) => cb(m)),
  win: {
    min: () => inv('win:min'), max: () => inv('win:max'), close: () => inv('win:close'), state: () => inv('win:state'),
    onState: (cb) => ipcRenderer.on('win:state', (e, s) => cb(s)),
  },
  license: {
    status: () => inv('lic:status'), activate: (k) => inv('lic:activate', String(k).slice(0, 1000)), logout: () => inv('lic:logout'),
    onLost: (cb) => ipcRenderer.on('lic:lost', () => cb()),
  },
  opt: {
    catalog: () => inv('opt:catalog'),
    apply: (id) => inv('opt:apply', id),
    revert: (id) => inv('opt:revert', id),
    log: () => inv('opt:log'),
    startup: () => inv('opt:startup'),
    startupSet: (id, en) => inv('opt:startupSet', id, en),
    cleanScan: () => inv('opt:cleanScan'),
    cleanRun: (ids, bytes) => inv('opt:cleanRun', ids, bytes),
    restorePoint: () => inv('opt:restorePoint'),
    kill: (pid, name) => inv('opt:kill', pid, name),
  },
});
