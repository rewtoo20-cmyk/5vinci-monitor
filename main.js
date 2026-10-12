// 5VINCI Monitor: главный процесс. Собирает данные о системе и отдаёт их окну.
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const si = require('systeminformation');
const T = require('./tweaks.js');

let win = null;
let tick = 0;
let busy = false;
let timer = null;
const cache = { temp: null, gpu: null, disks: [], procs: [] };
const live = [];          // последние 10 минут, каждую секунду
let hist = [];            // до 24 часов, одна точка в 10 секунд
let acc = [];
let lastSave = 0;

const histFile = () => path.join(app.getPath('userData'), 'history.json');
function loadHist() {
  try {
    const d = JSON.parse(fs.readFileSync(histFile(), 'utf8'));
    if (Array.isArray(d)) hist = d.filter((p) => p && Date.now() - p.t < 864e5);
  } catch (e) {}
}
function saveHist() {
  try { fs.writeFileSync(histFile(), JSON.stringify(hist)); } catch (e) {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 980, minHeight: 660,
    backgroundColor: '#0a0806', title: '5VINCI Optimizer', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

async function poll() {
  if (busy || !win) return;
  busy = true;
  try {
    const [load, mem, net] = await Promise.all([si.currentLoad(), si.mem(), si.networkStats('*').catch(() => [])]);
    if (tick % 3 === 0) {
      try { const t = await si.cpuTemperature(); cache.temp = Number.isFinite(t.main) && t.main > 0 ? t.main : (Number.isFinite(t.max) && t.max > 0 ? t.max : null); } catch (e) {}
      try {
        const p = await si.processes();
        const list = (p.list || []).filter((x) => x.name && x.pid > 0 && !/^(System Idle Process|Idle)$/i.test(x.name));
        const byCpu = list.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 25);
        const byMem = list.slice().sort((a, b) => b.memRss - a.memRss).slice(0, 15);
        const seen = new Set(), out = [];
        for (const x of byCpu.concat(byMem)) { if (seen.has(x.pid)) continue; seen.add(x.pid); out.push({ pid: x.pid, name: x.name, cpu: num(x.cpu), mem: num(x.memRss) * 1024 }); }
        cache.procs = out;
      } catch (e) {}
    }
    if (tick % 15 === 0) {
      try {
        const fs2 = await si.fsSize();
        cache.disks = fs2.filter((d) => d.size > 0).map((d) => ({ mount: d.mount, fs: d.fs, type: d.type, size: d.size, used: d.used, pct: num(d.use) }));
      } catch (e) {}
      try {
        const g = await si.graphics();
        const c = (g.controllers || []).find((x) => x.model) || null;
        cache.gpu = c ? { name: c.model, load: Number.isFinite(c.utilizationGpu) ? c.utilizationGpu : null, temp: Number.isFinite(c.temperatureGpu) ? c.temperatureGpu : null, memUsed: Number.isFinite(c.memoryUsed) ? c.memoryUsed : null, memTotal: Number.isFinite(c.memoryTotal) ? c.memoryTotal : (Number.isFinite(c.vram) ? c.vram : null) } : null;
      } catch (e) {}
    }
    let rx = 0, tx = 0;
    for (const n of net || []) { if (n.operstate === 'up' || n.operstate === 'unknown') { rx += num(n.rx_sec); tx += num(n.tx_sec); } }
    const used = mem.total - mem.available;
    const s = {
      ts: Date.now(),
      cpu: { load: num(load.currentLoad), cores: (load.cpus || []).map((c) => num(c.load)), temp: cache.temp },
      mem: { used, total: mem.total, pct: mem.total ? (used / mem.total) * 100 : 0 },
      net: { rx, tx },
      disks: cache.disks, gpu: cache.gpu, procs: cache.procs, uptime: os.uptime(),
    };
    const pt = { t: s.ts, cpu: s.cpu.load, mem: s.mem.pct, temp: s.cpu.temp, rx, tx };
    live.push(pt); if (live.length > 600) live.shift();
    acc.push(pt);
    if (acc.length >= 10) {
      const avg = (k) => { const v = acc.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      hist.push({ t: s.ts, cpu: avg('cpu'), mem: avg('mem'), temp: avg('temp'), rx: avg('rx'), tx: avg('tx') });
      if (hist.length > 8640) hist.shift();
      acc = [];
    }
    if (Date.now() - lastSave > 60000) { lastSave = Date.now(); saveHist(); }
    if (win && !win.isDestroyed()) win.webContents.send('stats', s);
  } catch (e) {
    if (win && !win.isDestroyed()) win.webContents.send('stats-error', String(e && e.message || e));
  } finally { busy = false; tick++; }
}

ipcMain.handle('info', async () => {
  const [cpu, osi] = await Promise.all([si.cpu().catch(() => ({})), si.osInfo().catch(() => ({}))]);
  return { cpu: [cpu.manufacturer, cpu.brand].filter(Boolean).join(' ') || os.cpus()[0].model, cores: cpu.cores || os.cpus().length, os: [osi.distro, osi.release].filter(Boolean).join(' ') || os.type(), host: os.hostname() };
});
ipcMain.handle('history', (e, sec) => {
  const since = Date.now() - sec * 1000;
  if (sec <= 600) return live.filter((p) => p.t >= since);
  return hist.filter((p) => p.t >= since).concat(live.filter((p) => p.t >= since).slice(-1));
});


// ---------- оптимизация ----------
const stateFile = () => path.join(app.getPath('userData'), 'state.json');
let state = { applied: {}, log: [] };
function loadState() { try { const d = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); if (d && d.applied) state = d; } catch (e) {} }
function saveState() { try { fs.writeFileSync(stateFile(), JSON.stringify(state)); } catch (e) {} }
function logAdd(id, title, action, ok, msg) {
  state.log.unshift({ at: Date.now(), id, title, action, ok, msg: msg || '' });
  if (state.log.length > 300) state.log.length = 300;
  saveState();
}
const titleOf = (id) => { const t = T.META.TWEAKS.find((x) => x.id === id); return t ? t.title : id; };
const PROTECTED = /^(system|registry|smss|csrss|wininit|services|lsass|winlogon|svchost|dwm|fontdrvhost|memory compression|system idle process|explorer|sihost|ctfmon|audiodg|taskhostw|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|securityhealthservice|msmpeng)(\.exe)?$/i;

ipcMain.handle('opt:catalog', async () => {
  const c = await T.checkAll();
  const plan = String(c.map._plan || '').toLowerCase();
  const items = T.META.TWEAKS.map((t) => {
    let applied = null;
    if (t.kind === 'choice') applied = plan.includes(T.GUID[t.id]);
    else if (t.kind === 'toggle') applied = T.IMPL[t.id].stateOnly ? !!state.applied[t.id] : !!c.map[t.id];
    return Object.assign({}, t, { applied });
  });
  return { items, laptop: !!c.map._laptop, ok: c.ok, err: c.err, win: process.platform === 'win32' };
});
ipcMain.handle('opt:apply', async (e, id) => {
  const r = await T.applyOne(id, state);
  if (r.ok && !r.action) { state.applied[id] = { at: Date.now(), prev: r.prev || {} }; if (r.choice) T.META.TWEAKS.filter((x) => x.group === 'plan').forEach((x) => { if (x.id !== id) delete state.applied[x.id]; }); saveState(); }
  logAdd(id, titleOf(id), r.action ? 'run' : 'apply', r.ok, r.ok ? '' : r.msg);
  return r;
});
ipcMain.handle('opt:revert', async (e, id) => {
  const prev = state.applied[id] ? state.applied[id].prev : {};
  const r = await T.revertOne(id, prev);
  if (r.ok) { delete state.applied[id]; saveState(); }
  logAdd(id, titleOf(id), 'revert', r.ok, r.ok ? '' : r.msg);
  return r;
});
ipcMain.handle('opt:log', () => ({ log: state.log, applied: Object.keys(state.applied) }));
ipcMain.handle('opt:startup', () => T.startupList());
ipcMain.handle('opt:startupSet', async (e, id, en) => { const r = await T.startupSet(id, en); logAdd('startup', String(id).split('|').slice(1).join('|'), en ? 'startup-on' : 'startup-off', r.ok, r.ok ? '' : r.msg); return r; });
ipcMain.handle('opt:cleanScan', () => T.cleanScan());
ipcMain.handle('opt:cleanRun', async (e, ids, bytes) => { const r = await T.cleanRun(ids); logAdd('clean', 'Очистка диска', 'clean', r.ok, String(bytes || 0)); return r; });
ipcMain.handle('opt:restorePoint', async () => { const r = await T.createRestorePoint(); logAdd('restore', 'Точка восстановления', 'run', r.ok, r.ok ? '' : r.msg); return r; });
ipcMain.handle('opt:kill', (e, pid, name) => {
  if (!Number.isInteger(pid) || pid < 5 || pid === process.pid) return { ok: false, msg: 'Нельзя' };
  if (PROTECTED.test(String(name || ''))) return { ok: false, msg: 'Системный процесс: его закрывать нельзя' };
  try { process.kill(pid); logAdd('proc', String(name || pid), 'kill', true, ''); return { ok: true }; } catch (err) { return { ok: false, msg: 'Не получилось закрыть: ' + (err.code === 'EPERM' ? 'нет прав' : err.message) }; }
});

app.whenReady().then(() => {
  loadHist();
  loadState();
  createWindow();
  timer = setInterval(poll, 1000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('before-quit', () => { clearInterval(timer); saveHist(); });
app.on('window-all-closed', () => { app.quit(); });
