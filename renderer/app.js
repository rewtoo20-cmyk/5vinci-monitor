// 5VINCI Monitor: окно с графиками. Если запущено без Electron (в браузере), показывает тестовые данные.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var api = window.api || mockApi();
  window.__api = api;

  var COL = { acc: '#ff8a1f', acc2: '#ffb15c', green: '#34e39a', blue: '#58b7ff', red: '#ff5b5b' };
  var LIVE_MAX = 600;
  var live = { cpu: [], mem: [], rx: [], tx: [] };
  var sortKey = 'cpu', sortDir = -1, lastProcs = [], histSec = 600, lastHistDraw = 0, last = null;

  function bytes(n) {
    n = +n || 0;
    var u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n >= 100 || i === 0 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
  }
  function speed(n) { return bytes(n) + '/с'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function push(arr, v, max) { arr.push(v); if (arr.length > max) arr.shift(); }
  function uptime(sec) {
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    return 'работает ' + (d ? d + ' д ' : '') + h + ' ч ' + m + ' мин';
  }

  // ---------- графики ----------
  function prep(cv) {
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    return { c: c, w: w, h: h };
  }
  // series: [{data:[...], color, fill}], opt: {max, min, fmt, grid, axis}
  function chart(cv, series, opt) {
    var p = prep(cv); if (!p) return;
    opt = opt || {};
    var c = p.c, w = p.w, h = p.h, padL = opt.axis ? 38 : 0, padB = opt.axis ? 16 : 0, gw = w - padL, gh = h - padB;
    var max = opt.max;
    if (!max) { max = 1; series.forEach(function (s) { s.data.forEach(function (v) { if (v != null && v > max) max = v; }); }); max *= 1.15; }
    if (opt.grid) {
      c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1; c.fillStyle = '#9b8b7d'; c.font = '10px sans-serif'; c.textAlign = 'right';
      for (var g = 0; g <= 4; g++) {
        var y = Math.round(gh * g / 4) + .5;
        c.beginPath(); c.moveTo(padL, y); c.lineTo(w, y); c.stroke();
        if (opt.axis) c.fillText((opt.fmt ? opt.fmt(max * (1 - g / 4)) : Math.round(max * (1 - g / 4))), padL - 6, Math.min(gh - 2, y + 10 - (g ? 5 : 0)));
      }
    }
    series.forEach(function (s) {
      var d = s.data, n = d.length; if (n < 2) return;
      var span = opt.count || n, step = gw / Math.max(1, span - 1), off = gw - (n - 1) * step;
      c.beginPath();
      var started = false, firstX = 0, lastX = 0;
      d.forEach(function (v, i) {
        if (v == null) { started = false; return; }
        var x = padL + off + i * step, y = gh - Math.min(1, v / max) * (gh - 4) - 2;
        if (!started) { c.moveTo(x, y); started = true; firstX = x; } else c.lineTo(x, y);
        lastX = x;
      });
      c.strokeStyle = s.color; c.lineWidth = 1.8; c.lineJoin = 'round'; c.stroke();
      if (s.fill !== false) {
        c.lineTo(lastX, gh); c.lineTo(firstX, gh); c.closePath();
        var gr = c.createLinearGradient(0, 0, 0, gh); gr.addColorStop(0, s.color + '55'); gr.addColorStop(1, s.color + '00');
        c.fillStyle = gr; c.fill();
      }
    });
  }

  // ---------- обновление экрана ----------
  function onStats(s) {
    last = s;
    window.__stats = s; window.dispatchEvent(new CustomEvent('vstats'));
    $('dot').classList.remove('bad');
    var cpu = s.cpu.load, mem = s.mem;
    push(live.cpu, cpu, LIVE_MAX); push(live.mem, mem.pct, LIVE_MAX); push(live.rx, s.net.rx, LIVE_MAX); push(live.tx, s.net.tx, LIVE_MAX);

    $('cpuPct').textContent = Math.round(cpu);
    $('cpuSub').textContent = (s.cpu.cores.length || '') + ' потоков';
    var cores = $('cores');
    if (cores.children.length !== s.cpu.cores.length) cores.innerHTML = s.cpu.cores.map(function () { return '<i></i>'; }).join('');
    s.cpu.cores.forEach(function (v, i) { cores.children[i].style.height = Math.max(4, v) + '%'; cores.children[i].title = 'Ядро ' + (i + 1) + ': ' + Math.round(v) + '%'; });

    $('ramPct').textContent = Math.round(mem.pct);
    $('ramSub').textContent = bytes(mem.total);
    $('ramUsed').textContent = 'Занято ' + bytes(mem.used);
    $('ramTotal').textContent = 'Свободно ' + bytes(mem.total - mem.used);
    var rb = $('ramBar'); rb.style.width = mem.pct.toFixed(1) + '%'; rb.classList.toggle('hot', mem.pct > 85);

    setTemp('tCpu', s.cpu.temp, true);
    var g = s.gpu;
    $('gName').textContent = g && g.name ? g.name : 'Видеокарта';
    setTemp('tGpu', g ? g.temp : null, true);
    setVal('gLoad', g && g.load != null ? Math.round(g.load) + '%' : null);
    setVal('gMem', g && g.memTotal ? (g.memUsed != null ? Math.round(g.memUsed) + ' из ' : '') + Math.round(g.memTotal) + ' МБ' : null);
    $('tHint').style.display = s.cpu.temp == null ? '' : 'none';

    $('rx').textContent = speed(s.net.rx); $('tx').textContent = speed(s.net.tx);
    $('uptime').textContent = uptime(s.uptime);

    renderDisks(s.disks);
    lastProcs = s.procs || []; renderProcs();
    drawLive();
    if (Date.now() - lastHistDraw > (histSec <= 600 ? 1000 : 5000)) drawHist();
  }
  function setVal(id, text) { var e = $(id); e.textContent = text == null ? 'нет данных' : text; e.classList.toggle('na', text == null); }
  function setTemp(id, t, c) { var e = $(id); if (t == null) { setVal(id, null); return; } e.textContent = Math.round(t) + ' °C'; e.classList.remove('na'); e.style.color = t > 85 ? COL.red : t > 70 ? COL.acc : ''; }
  function drawLive() {
    var n = Math.min(120, Math.max(30, live.cpu.length));
    chart($('chCpu'), [{ data: live.cpu.slice(-n), color: COL.acc }], { max: 100, count: n, grid: true });
    chart($('chRam'), [{ data: live.mem.slice(-n), color: COL.blue }], { max: 100, count: n, grid: true });
    chart($('chNet'), [{ data: live.rx.slice(-n), color: COL.green }, { data: live.tx.slice(-n), color: COL.acc2 }], { count: n, grid: true });
  }
  function renderDisks(list) {
    var box = $('diskList');
    if (!list || !list.length) { box.innerHTML = '<p class="hint">Данных о дисках пока нет.</p>'; return; }
    box.innerHTML = list.map(function (d) {
      return '<div class="dk"><div class="t"><span>' + esc(d.mount || d.fs) + '</span><span>' + bytes(d.used) + ' из ' + bytes(d.size) + ' · ' + Math.round(d.pct) + '%</span></div><div class="bar"><i class="' + (d.pct > 90 ? 'hot' : '') + '" style="width:' + Math.min(100, d.pct).toFixed(1) + '%"></i></div></div>';
    }).join('');
  }
  function renderProcs() {
    var rows = lastProcs.slice().sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
    }).slice(0, 12);
    $('procBody').innerHTML = rows.map(function (p) {
      return '<tr><td title="' + esc(p.name) + ' (PID ' + p.pid + ')">' + esc(p.name) + '</td><td class="r"><span class="pb"><i style="width:' + Math.min(100, p.cpu).toFixed(0) + '%"></i></span>' + p.cpu.toFixed(1) + '%</td><td class="r">' + bytes(p.mem) + '</td><td class="r"><button class="kill" data-pid="' + p.pid + '" data-name="' + esc(p.name) + '">Закрыть</button></td></tr>';
    }).join('') || '<tr><td colspan="4" class="sub">Список процессов загружается…</td></tr>';
  }
  document.querySelector('.procs thead').addEventListener('click', function (e) {
    var th = e.target.closest('th'); if (!th || !th.dataset.k) return;
    var k = th.dataset.k;
    if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; }
    document.querySelectorAll('.procs th').forEach(function (x) {
      var on = x.dataset.k === sortKey; x.classList.toggle('on', on);
      x.textContent = x.textContent.replace(/ [↓↑]$/, '') + (on ? (sortDir < 0 ? ' ↓' : ' ↑') : '');
    });
    renderProcs();
  });

  // ---------- история ----------
  function drawHist() {
    lastHistDraw = Date.now();
    api.history(histSec).then(function (pts) {
      var f = function (k) { return pts.map(function (p) { return p[k]; }); };
      var temps = f('temp'), hasT = temps.some(function (v) { return v != null; });
      var series = [{ data: f('cpu'), color: COL.acc }, { data: f('mem'), color: COL.blue, fill: false }];
      if (hasT) series.push({ data: temps, color: COL.green, fill: false });
      chart($('chHist'), series, { max: 100, grid: true, axis: true, fmt: function (v) { return Math.round(v) + '%'; } });
    }).catch(function () {});
  }
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    histSec = +b.dataset.s;
    document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    drawHist();
  });

  window.addEventListener('resize', function () { drawLive(); drawHist(); });
  window.__monRedraw = function () { drawLive(); drawHist(); };
  api.onError && api.onError(function () { $('dot').classList.add('bad'); });
  api.info().then(function (i) {
    $('sysCpu').textContent = i.cpu + ' · ' + i.cores + ' потоков';
    $('sysOs').textContent = i.os + ' · ' + i.host;
  });
  api.onStats(onStats);

  // ---------- тестовые данные, если открыто не в приложении ----------
  function mockApi() {
    var h = [], t0 = Date.now(), cpu = 30, mem = 55, tmp = 52;
    function walk(v, a, lo, hi) { v += (Math.random() - .5) * a; return Math.max(lo, Math.min(hi, v)); }
    for (var i = 8640; i > 0; i--) { cpu = walk(cpu, 12, 3, 95); mem = walk(mem, 1.5, 35, 80); tmp = walk(tmp, 2, 38, 80); h.push({ t: t0 - i * 10000, cpu: cpu, mem: mem, temp: tmp }); }
    var procs = ['chrome.exe', 'Code.exe', 'System', 'steam.exe', 'Discord.exe', 'explorer.exe', 'svchost.exe', 'obs64.exe', 'dwm.exe', 'MsMpEng.exe', 'node.exe', 'spotify.exe', 'TelegramDesktop.exe', 'Windows Search Indexer'];
    var cb = null, rx = 800000, tx = 120000;
    return {
      info: function () { return Promise.resolve({ cpu: 'AMD Ryzen 7 5800X 8-Core', cores: 16, os: 'Windows 11 Pro 24H2', host: 'DESKTOP-5VINCI' }); },
      history: function (sec) { var since = Date.now() - sec * 1000; return Promise.resolve(sec <= 600 ? h.slice(-60).map(function (p, i) { return { t: Date.now() - (60 - i) * 1000, cpu: p.cpu, mem: p.mem, temp: p.temp }; }) : h.filter(function (p) { return p.t >= since; })); },
      onStats: function (f) {
        cb = f;
        setInterval(function () {
          cpu = walk(cpu, 14, 3, 95); mem = walk(mem, 1, 35, 80); tmp = walk(tmp, 2, 38, 80); rx = walk(rx, 900000, 0, 12e6); tx = walk(tx, 250000, 0, 3e6);
          var total = 32 * 1024 * 1024 * 1024;
          cb({ ts: Date.now(), cpu: { load: cpu, cores: Array.from({ length: 16 }, function () { return Math.max(0, Math.min(100, cpu + (Math.random() - .5) * 50)); }), temp: tmp }, mem: { used: total * mem / 100, total: total, pct: mem }, net: { rx: rx, tx: tx },
            disks: [{ mount: 'C:', size: 953e9, used: 612e9, pct: 64 }, { mount: 'D:', size: 1863e9, used: 1710e9, pct: 92 }],
            gpu: { name: 'NVIDIA GeForce RTX 4070', load: walk(40, 40, 0, 100), temp: 61, memUsed: 3200, memTotal: 12288 },
            procs: procs.map(function (n, i) { return { pid: 100 + i, name: n, cpu: Math.max(0, cpu / (i + 1.5) + Math.random() * 3), mem: (900 - i * 55) * 1048576 }; }), uptime: 93600 });
        }, 1000);
      },
      onError: function () {},
      opt: window.MOCK_OPT,
    };
  }
})();
