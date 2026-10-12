// 5VINCI Optimizer: главный процесс. Окно, мониторинг, оптимизации, проверка ключа.
'use strict';
const { app, BrowserWindow, ipcMain, Menu, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Слабые и старые видеокарты: если графика падала, в следующий раз запускаемся без неё
const gpuFlag = path.join(app.getPath('userData'), 'nogpu.flag');
try { if (fs.existsSync(gpuFlag)) app.disableHardwareAcceleration(); } catch (e) {}
app.setAppUserModelId('com.vinci5.optimizer');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const si = require('systeminformation');
const T = require('./tweaks.js');
const L = require('./license.js');

let win = null, tick = 0, busy = false, timer = null, page = 'home', lastHistT = 0, gpuFails = 0;
const cache = { temp: null, gpu: null, disks: [], procs: [] };
const live = [];          // последние 10 минут, каждую секунду
let hist = [];            // до 24 часов, одна точка в 10 секунд
let acc = [];
let lastSave = 0;

const histFile = () => path.join(app.getPath('userData'), 'history.json');
function writeAtomic(file, data) { try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); } catch (e) {} }
function loadHist() {
  try { const d = JSON.parse(fs.readFileSync(histFile(), 'utf8')); if (Array.isArray(d)) hist = d.filter((p) => p && Date.now() - p.t < 864e5).slice(-8640); } catch (e) {}
}
const saveHist = () => writeAtomic(histFile(), JSON.stringify(hist));

function createWindow() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1240, wa.width), height: Math.min(820, wa.height),
    minWidth: Math.min(980, wa.width), minHeight: Math.min(660, wa.height),
    frame: false, show: false, backgroundColor: '#0a0806', title: '5VINCI Optimizer',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, devTools: !app.isPackaged, spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win && win.show());
  const send = () => { if (win && !win.isDestroyed()) win.webContents.send('win:state', { max: win.isMaximized() }); };
  win.on('maximize', send); win.on('unmaximize', send);
  win.on('restore', () => { tick = 0; });
  win.on('closed', () => { win = null; });
  if (app.isPackaged) {
    win.webContents.on('before-input-event', (e, i) => {
      const k = String(i.key || '').toLowerCase();
      if (k === 'f12' || ((i.control || i.meta) && i.shift && ['i', 'j', 'c'].includes(k))) e.preventDefault();
    });
  }
}

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

async function poll() {
  if (busy || !win || win.isDestroyed() || !L.valid()) return;
  const visible = win.isVisible() && !win.isMinimized();
  if (!visible && tick % 3 !== 0) { tick++; return; }   // в свёрнутом окне опрашиваем втрое реже
  busy = true;
  try {
    const mon = page === 'monitor', heavy = visible && (mon || page === 'home');
    const [load, mem, net] = await Promise.all([si.currentLoad(), si.mem(), si.networkStats('*').catch(() => [])]);
    if (visible && (mon ? tick % 3 === 0 : tick % 15 === 0)) {
      try { const t = await si.cpuTemperature(); cache.temp = Number.isFinite(t.main) && t.main > 0 ? t.main : (Number.isFinite(t.max) && t.max > 0 ? t.max : null); } catch (e) {}
    }
    if (visible && mon && tick % 3 === 0) {
      try {
        const p = await si.processes();
        const list = (p.list || []).filter((x) => x.name && x.pid > 0 && !/^(System Idle Process|Idle)$/i.test(x.name));
        const byCpu = list.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 25);
        const byMem = list.slice().sort((a, b) => b.memRss - a.memRss).slice(0, 15);
        const seen = new Set(), out = [];
        for (const x of byCpu.concat(byMem)) { if (seen.has(x.pid)) continue; seen.add(x.pid); out.push({ pid: x.pid, name: String(x.name), cpu: num(x.cpu), mem: num(x.memRss) * 1024 }); }
        cache.procs = out;
      } catch (e) {}
    }
    if (heavy && tick % 15 === 0) {
      try {
        const fs2 = await si.fsSize();
        cache.disks = fs2.filter((d) => d.size > 0).map((d) => ({ mount: d.mount, fs: d.fs, type: d.type, size: d.size, used: d.used, pct: num(d.use) }));
      } catch (e) {}
      if (mon) {
        try {
          const g = await si.graphics();
          const c = (g.controllers || []).find((x) => x.model) || null;
          cache.gpu = c ? { name: c.model, load: Number.isFinite(c.utilizationGpu) ? c.utilizationGpu : null, temp: Number.isFinite(c.temperatureGpu) ? c.temperatureGpu : null, memUsed: Number.isFinite(c.memoryUsed) ? c.memoryUsed : null, memTotal: Number.isFinite(c.memoryTotal) ? c.memoryTotal : (Number.isFinite(c.vram) ? c.vram : null) } : null;
        } catch (e) {}
      }
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
    if (s.ts - lastHistT >= 10000 && acc.length) {
      const avg = (k) => { const v = acc.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      hist.push({ t: s.ts, cpu: avg('cpu'), mem: avg('mem'), temp: avg('temp'), rx: avg('rx'), tx: avg('tx') });
      if (hist.length > 8640) hist.shift();
      acc = []; lastHistT = s.ts;
    }
    if (Date.now() - lastSave > 60000) { lastSave = Date.now(); saveHist(); }
    if (win && !win.isDestroyed()) win.webContents.send('stats', s);
  } catch (e) {
    if (win && !win.isDestroyed()) win.webContents.send('stats-error', String(e && e.message || e));
  } finally { busy = false; tick++; }
}

// ---------- безопасные обработчики ----------
// Принимаем вызовы только от нашего окна; всё, кроме проверки ключа, работает только с действующим ключом.
function H(channel, fn, open) {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      if (!win || e.sender !== win.webContents || !String(e.senderFrame && e.senderFrame.url).startsWith('file://')) return { ok: false, msg: 'Запрещено' };
      if (!open && !L.valid()) return { ok: false, locked: true, msg: 'Нужен ключ' };
      return await fn(...args);
    } catch (err) { return { ok: false, msg: 'Ошибка: ' + (err && err.message || err) }; }
  });
}
const isStr = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= (n || 400);

// окно
H('win:min', () => { win.minimize(); return { ok: true }; }, true);
H('win:max', () => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); return { ok: true, max: win.isMaximized() }; }, true);
H('win:close', () => { win.close(); return { ok: true }; }, true);
H('win:state', () => ({ ok: true, max: win.isMaximized() }), true);

// ключ
let actFails = 0, actBlock = 0;
H('lic:status', () => L.status(), true);
H('lic:activate', async (key) => {
  if (Date.now() < actBlock) return { ok: false, msg: 'Слишком много попыток. Подожди минуту' };
  if (!isStr(key, 1000)) return { ok: false, msg: 'Вставь ключ' };
  const r = await L.activate(key);
  if (!r.ok) { if (++actFails >= 5) { actFails = 0; actBlock = Date.now() + 60000; } } else actFails = 0;
  if (r.ok) { tick = 0; }
  return r;
}, true);
H('lic:logout', () => { const r = L.logout(); return r; }, true);

// мониторинг
H('info', async () => {
  const [cpu, osi] = await Promise.all([si.cpu().catch(() => ({})), si.osInfo().catch(() => ({}))]);
  return { ok: true, cpu: [cpu.manufacturer, cpu.brand].filter(Boolean).join(' ') || (os.cpus()[0] || {}).model || 'Процессор', cores: cpu.cores || os.cpus().length, os: [osi.distro, osi.release].filter(Boolean).join(' ') || os.type(), host: os.hostname() };
});
H('history', (sec) => {
  sec = Number(sec); if (!Number.isFinite(sec) || sec < 1 || sec > 86400) sec = 600;
  const since = Date.now() - sec * 1000;
  if (sec <= 600) return live.filter((p) => p.t >= since);
  return hist.filter((p) => p.t >= since).concat(live.filter((p) => p.t >= since).slice(-1));
});
H('ui:page', (p) => { if (['home', 'monitor'].includes(p) || String(p).length < 20) { if (p === 'monitor' && page !== 'monitor') tick = 0; page = String(p); } return { ok: true }; });

// ---------- оптимизация ----------
const stateFile = () => path.join(app.getPath('userData'), 'state.json');
let state = { applied: {}, log: [] };
function loadState() { try { const d = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); if (d && d.applied && Array.isArray(d.log)) state = d; } catch (e) {} }
const saveState = () => writeAtomic(stateFile(), JSON.stringify(state));
function logAdd(id, title, action, ok, msg) {
  state.log.unshift({ at: Date.now(), id, title, action, ok, msg: msg || '' });
  if (state.log.length > 300) state.log.length = 300;
  saveState();
}
const titleOf = (id) => { const t = T.META.TWEAKS.find((x) => x.id === id); return t ? t.title : id; };
const PROTECTED = /^(system|registry|smss|csrss|wininit|services|lsass|winlogon|svchost|dwm|fontdrvhost|memory compression|system idle process|explorer|sihost|ctfmon|audiodg|taskhostw|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|securityhealthservice|securityhealthsystray|msmpeng|wudfhost|spoolsv|lsm|conhost|dllhost|msedgewebview2|electron|5vinci.*)(\.exe)?$/i;

H('opt:catalog', async () => {
  const c = await T.checkAll();
  const m = c.map || {}, plan = String(m._plan || '').toLowerCase(), build = Number(m._build) || 0;
  const items = T.META.TWEAKS.map((t) => {
    let applied = null;
    if (t.kind === 'choice') applied = plan.includes(T.GUID[t.id]);
    else if (t.kind === 'toggle') applied = T.IMPL[t.id].stateOnly ? !!state.applied[t.id] : m[t.id] === true;
    const hide = (t.kind === 'toggle' && !T.IMPL[t.id].stateOnly && m[t.id] === 'na') || (t.win11 && build > 0 && build < 22000);
    return Object.assign({}, t, { applied, hide: !!hide });
  });
  return { ok: true, items, laptop: !!m._laptop, admin: m._admin !== false, build, sysok: c.ok, err: c.err, win: process.platform === 'win32' };
});
H('opt:apply', async (id) => {
  if (!T.known(id)) return { ok: false, msg: 'Неизвестная оптимизация' };
  const r = await T.applyOne(id, state);
  if (r.ok && !r.action) { state.applied[id] = { at: Date.now(), prev: r.prev || {} }; if (r.choice) T.META.TWEAKS.filter((x) => x.group === 'plan').forEach((x) => { if (x.id !== id) delete state.applied[x.id]; }); saveState(); }
  logAdd(id, titleOf(id), r.action ? 'run' : 'apply', r.ok, r.ok ? (r.action ? r.msg : '') : r.msg);
  return r;
});
H('opt:revert', async (id) => {
  if (!T.known(id)) return { ok: false, msg: 'Неизвестная оптимизация' };
  const prev = state.applied[id] ? state.applied[id].prev : {};
  const r = await T.revertOne(id, prev);
  if (r.ok) { delete state.applied[id]; saveState(); }
  logAdd(id, titleOf(id), 'revert', r.ok, r.ok ? '' : r.msg);
  return r;
});
H('opt:log', () => ({ ok: true, log: state.log, applied: Object.keys(state.applied) }));
H('opt:startup', () => T.startupList());
H('opt:startupSet', async (id, en) => {
  if (!isStr(id) || typeof en !== 'boolean') return { ok: false, msg: 'Неверный запрос' };
  const r = await T.startupSet(id, en);
  logAdd('startup', id.split('|').slice(1).join('|'), en ? 'startup-on' : 'startup-off', r.ok, r.ok ? '' : r.msg);
  return r;
});
H('opt:cleanScan', () => T.cleanScan());
H('opt:cleanRun', async (ids, bytes) => {
  if (!Array.isArray(ids) || ids.length > 50 || !ids.every((x) => isStr(x, 40))) return { ok: false, msg: 'Неверный запрос' };
  const r = await T.cleanRun(ids);
  logAdd('clean', 'Очистка диска', 'clean', r.ok, String(Math.max(0, Math.min(Number(bytes) || 0, 1e13))));
  return r;
});
H('opt:restorePoint', async () => { const r = await T.createRestorePoint(); logAdd('restore', 'Точка восстановления', 'run', r.ok, r.ok ? '' : r.msg); return r; });
H('opt:kill', (pid, name) => {
  // имя берём из своего списка процессов, а не из запроса: подделать его нельзя
  const p = cache.procs.find((x) => x.pid === pid);
  if (!Number.isInteger(pid) || pid < 5 || pid === process.pid || !p) return { ok: false, msg: 'Процесс не найден. Обнови список' };
  if (PROTECTED.test(p.name)) return { ok: false, msg: 'Системный процесс: его закрывать нельзя' };
  try { process.kill(pid); logAdd('proc', p.name, 'kill', true, ''); return { ok: true }; } catch (err) { return { ok: false, msg: 'Не получилось закрыть: ' + (err.code === 'EPERM' ? 'нет прав' : err.message) }; }
});

// ---------- защита окна ----------
app.on('web-contents-created', (e, c) => {
  c.on('will-navigate', (ev) => ev.preventDefault());
  c.on('will-attach-webview', (ev) => ev.preventDefault());
  c.setWindowOpenHandler(() => ({ action: 'deny' }));
});
app.on('child-process-gone', (e, d) => {
  if (d.type === 'GPU' && d.reason !== 'clean-exit' && ++gpuFails >= 2) {
    try { fs.writeFileSync(gpuFlag, '1'); } catch (er) {}
    app.relaunch(); app.exit(0);
  }
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  loadHist(); loadState();
  await L.init(app.getPath('userData'));
  createWindow();
  timer = setInterval(poll, 1000);
  // каждые 5 минут проверяем, не закончился ли ключ
  setInterval(async () => { const s = await L.status(); if (!s.ok && win && !win.isDestroyed()) win.webContents.send('lic:lost'); }, 300000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('before-quit', () => { clearInterval(timer); saveHist(); });
app.on('window-all-closed', () => { app.quit(); });
