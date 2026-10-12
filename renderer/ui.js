// 5VINCI Optimizer: экраны программы (главная, разделы, автозагрузка, очистка, журнал, мастер «Ускорить»)
(function () {
  'use strict';
  var api = window.__api, META = window.META, rawOpt = api.opt, opt = {};
  // любой ответ «нужен ключ» возвращает на экран входа
  Object.keys(rawOpt).forEach(function (k) { opt[k] = function () { return Promise.resolve(rawOpt[k].apply(null, arguments)).then(function (r) { if (r && r.locked && window.__showLock) window.__showLock(); return r; }); }; });
  var $ = function (id) { return document.getElementById(id); };
  var data = null, page = 'home', busy = {};

  var ICON = {
    home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
    wifi: '<path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10.5 10.5 0 0 1 13 0M8.6 16a6 6 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1.2"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    rocket: '<path d="M14 4c3 0 6 1 6 1s1 3 1 6-3 6-6 8l-5-5c2-3 4-6 4-10z"/><circle cx="14.5" cy="9.5" r="1.5"/><path d="M8 14l-4 1 3 3m2-4l-1 5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
    chart: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5L16 9.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    undo: '<path d="M9 8H4V3M4 8a9 9 0 1 1-1 5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  };
  var ico = function (n, s) { return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function bytes(n) { n = +n || 0; var u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'], i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i === 0 || n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i]; }
  function tm(ts) { var d = new Date(ts), p = function (x) { return (x < 10 ? '0' : '') + x; }; return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  var catOf = function (id) { return META.CATS.filter(function (c) { return c.id === id; })[0]; };
  var tw = function (id) { return data && data.items.filter(function (t) { return t.id === id; })[0]; };

  function toast(msg, ok) {
    var el = document.createElement('div'); el.className = 'toast ' + (ok === false ? 'bad' : 'ok'); el.textContent = msg;
    $('toasts').appendChild(el); setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 3200);
  }
  function modal(html) { $('mbox').innerHTML = html; $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; $('mbox').innerHTML = ''; }
  $('modal').addEventListener('mousedown', function (e) { if (e.target === $('modal') && !busy.wizard) closeModal(); });

  // ---------- меню ----------
  var NAV = [
    ['home', 'home', 'Главная'], ['cat:net', 'wifi', 'Интернет'], ['cat:power', 'bolt', 'Батарея и питание'], ['cat:perf', 'rocket', 'Производительность'],
    ['cat:priv', 'eye', 'Приватность'], ['cat:ui', 'layout', 'Проводник и вид'], ['cat:svc', 'gear', 'Службы Windows'], ['startup', 'play', 'Автозагрузка'], ['clean', 'trash', 'Очистка диска'], ['monitor', 'chart', 'Мониторинг'], ['log', 'list', 'Журнал изменений'],
  ];
  function renderNav() {
    $('nav').innerHTML = NAV.map(function (n, i) {
      return (i === 1 || i === 7 || i === 9 ? '<div class="sep"></div>' : '') + '<button data-p="' + n[0] + '" class="' + (n[0] === page ? 'on' : '') + '">' + ico(n[1]) + '<span>' + n[2] + '</span></button>';
    }).join('');
  }
  $('nav').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(b.dataset.p); });
  function go(p) {
    page = p; renderNav(); try { api.page && api.page(p === 'monitor' ? 'monitor' : p === 'home' ? 'home' : 'other'); } catch (e) {}
    var id = p.indexOf('cat:') === 0 ? 'cat' : p;
    document.querySelectorAll('.page').forEach(function (x) { x.classList.toggle('on', x.id === 'p-' + id); });
    $('content').scrollTop = 0;
    if (p === 'home') renderHome();
    else if (id === 'cat') renderCat(p.slice(4));
    else if (p === 'startup') renderStartup();
    else if (p === 'clean') renderClean();
    else if (p === 'log') renderLog();
    else if (p === 'monitor') setTimeout(function () { window.__monRedraw && window.__monRedraw(); }, 30);
  }

  async function load(force) {
    if (data && !force) return data;
    var d = await opt.catalog();
    if (d && d.locked) { data = null; window.__showLock && window.__showLock(); throw new Error('locked'); }
    if (!d || !d.items) throw new Error('no data');
    data = d;
    return data;
  }
  function counts(catId) {
    var l = data.items.filter(function (t) { return t.cat === catId && !t.hide && (!t.laptop || data.laptop) && (t.kind === 'toggle' || (t.kind === 'choice' && t.id === 'plan_perf')); });
    return { on: l.filter(function (t) { return t.applied; }).length, all: l.length };
  }

  function loadErr(el) { if (!window.__locked) el.innerHTML = '<div class="skeleton">Не удалось получить данные о системе. <button class="btn sm" data-act="reload">Повторить</button></div>'; }
  // ---------- главная ----------
  async function renderHome() {
    var el = $('p-home');
    if (!el.dataset.ready) el.innerHTML = '<div class="skeleton">Загрузка…</div>';
    try { await load(); } catch (e) { return loadErr(el); } if (page !== 'home') return;
    var rec = data.items.filter(function (t) { return t.rec && t.kind === 'toggle' && !t.applied && !t.hide && (!t.laptop || data.laptop); });
    var done = data.items.filter(function (t) { return t.rec && t.kind === 'toggle' && t.applied; }).length;
    var tiles = META.CATS.map(function (c) { var n = counts(c.id); return tile(c.id, c.icon, c.hue, c.title, c.sub, n.on + ' из ' + n.all + ' включено', 'cat:' + c.id); }).join('') +
      tile('startup', 'play', 175, 'Автозагрузка', 'Что запускается вместе с Windows', 'Открыть список', 'startup') +
      tile('clean', 'trash', 350, 'Очистка диска', 'Убрать временные файлы и кэш', 'Найти мусор', 'clean');
    el.dataset.ready = '1';
    el.innerHTML =
      (data.admin === false ? '<div class="adm">Программа запущена без прав администратора, поэтому часть оптимизаций не применится. Закрой её и запусти от имени администратора.</div>' : '') + '<div class="hero"><div class="ht"><h1>Ускорь компьютер за минуту</h1><p>Мы проверим Windows, покажем, что можно отключить или почистить, и ты сам выберешь, что применить. Всё можно вернуть обратно.</p>' +
      '<div class="hbtn"><button class="btn big" data-act="wizard">' + ico('rocket', 22) + 'Проверить и ускорить</button>' + (done ? '<span class="chip ok">' + ico('check', 14) + 'Уже применено: ' + done + '</span>' : '') + '</div></div>' +
      '<div class="hs"><div class="m"><small>Процессор</small><b id="hCpu">—</b></div><div class="m"><small>Память</small><b id="hRam">—</b></div><div class="m"><small>Диск</small><b id="hDisk">—</b></div></div></div>' +
      '<h3 class="sec">Разделы</h3><div class="tiles">' + tiles + '</div>' +
      (rec.length ? '<h3 class="sec">Рекомендуем включить</h3><div class="rows">' + rec.slice(0, 5).map(row).join('') + '</div>' : '<div class="allgood">' + ico('shield', 26) + '<div><b>Всё рекомендованное уже включено</b><span>Загляни в разделы, чтобы настроить остальное.</span></div></div>');
    updHomeStats();
  }
  function tile(id, icon, hue, title, sub, status, target) {
    return '<button class="tile" data-go="' + target + '" style="--h:' + hue + '"><div class="ti">' + ico(icon, 26) + '</div><div class="tx"><b>' + title + '</b><span>' + sub + '</span></div><em>' + status + '</em></button>';
  }
  function updHomeStats() {
    var s = window.__stats; if (!s || !$('hCpu')) return;
    $('hCpu').textContent = Math.round(s.cpu.load) + '%'; $('hRam').textContent = Math.round(s.mem.pct) + '%';
    var d = (s.disks || [])[0]; $('hDisk').textContent = d ? Math.round(d.pct) + '%' : '—';
  }
  window.addEventListener('vstats', function () { if (page === 'home') updHomeStats(); });

  // ---------- строка оптимизации ----------
  function badges(t) {
    return (t.risk === 'caution' ? '<span class="bd warn">Осторожно</span>' : '<span class="bd safe">Безопасно</span>') + (t.reboot ? '<span class="bd">Нужна перезагрузка</span>' : '') + (t.laptop ? '<span class="bd">Для ноутбуков</span>' : '');
  }
  function row(t) {
    var ctl = t.kind === 'action' ? '<button class="btn sm" data-act="run" data-id="' + t.id + '"' + (busy[t.id] ? ' disabled' : '') + '>' + (busy[t.id] ? 'Выполняю…' : esc(t.btn || 'Выполнить')) + '</button>'
      : '<button class="sw' + (t.applied ? ' on' : '') + (busy[t.id] ? ' wait' : '') + '" role="switch" aria-checked="' + !!t.applied + '" data-act="toggle" data-id="' + t.id + '" aria-label="' + esc(t.title) + '"><i></i></button>';
    return '<div class="row' + (t.applied ? ' on' : '') + '"><div class="rt"><b>' + esc(t.title) + '</b><p>' + esc(t.desc) + '</p><div class="meta">' + badges(t) + '<span class="eff">' + esc(t.effect) + '</span></div></div><div class="rc">' + ctl + '</div></div>';
  }

  // ---------- раздел ----------
  async function renderCat(id) {
    var el = $('p-cat'), c = catOf(id);
    el.innerHTML = '<div class="skeleton">Загрузка…</div>'; try { await load(); } catch (e) { return loadErr(el); } if (page !== 'cat:' + id) return;
    var list = data.items.filter(function (t) { return t.cat === id && !t.hide && (!t.laptop || data.laptop); });
    var body = '', n = counts(id);
    if (id === 'power') {
      var plans = list.filter(function (t) { return t.kind === 'choice'; });
      body += '<h3 class="sec">План электропитания</h3><div class="plans">' + plans.map(function (t) {
        return '<button class="plan' + (t.applied ? ' on' : '') + '" data-act="choice" data-id="' + t.id + '"' + (busy[t.id] ? ' disabled' : '') + '><b>' + esc(t.title) + '</b><span>' + esc(t.desc) + '</span><em>' + (t.applied ? 'Выбрано' : esc(t.effect)) + '</em></button>';
      }).join('') + '</div><h3 class="sec">Настройки батареи</h3><div class="rows">' + list.filter(function (t) { return t.kind !== 'choice'; }).map(row).join('') + '</div>';
      if (!data.laptop) body += '<p class="hint">Батарея на этом компьютере не найдена, поэтому «Экономия заряда» тебе не нужна.</p>';
    } else body = '<div class="rows">' + list.map(row).join('') + '</div>';
    el.innerHTML = '<div class="pagehead"><div class="ph-i" style="--h:' + c.hue + '">' + ico(c.icon, 28) + '</div><div><h1>' + c.title + '</h1><p class="sub">' + c.sub + (n.all ? ' · включено ' + n.on + ' из ' + n.all : '') + '</p></div></div>' + (data.win === false ? '<p class="hint">Оптимизации работают только в Windows.</p>' : '') + body;
  }

  // ---------- автозагрузка ----------
  var SU = null;
  async function renderStartup() {
    var el = $('p-startup'); el.innerHTML = head('play', 175, 'Автозагрузка', 'Программы, которые запускаются вместе с Windows и замедляют включение') + '<div class="skeleton">Читаю список…</div>';
    var r = await opt.startup(); if (page !== 'startup') return; SU = r.list || [];
    var off = SU.filter(function (x) { return !x.enabled; }).length;
    el.innerHTML = head('play', 175, 'Автозагрузка', 'Включено ' + (SU.length - off) + ', выключено ' + off + '. Отключение ничего не удаляет: программу можно включить обратно.') +
      (SU.length ? '<div class="rows">' + SU.map(function (s) {
        return '<div class="row' + (s.enabled ? ' on' : '') + '"><div class="rt"><b>' + esc(s.name) + '</b><p class="path" title="' + esc(s.cmd) + '">' + esc(s.cmd) + '</p><div class="meta"><span class="bd">' + esc(s.src) + '</span></div></div><div class="rc"><button class="sw' + (s.enabled ? ' on' : '') + '" role="switch" aria-checked="' + !!s.enabled + '" data-act="su" data-id="' + esc(s.id) + '" aria-label="' + esc(s.name) + '"><i></i></button></div></div>';
      }).join('') + '</div>' : '<p class="hint">Программ в автозагрузке не найдено.' + (r.ok === false ? ' ' + esc(r.err || '') : '') + '</p>');
  }
  function head(icon, hue, t, sub) { return '<div class="pagehead"><div class="ph-i" style="--h:' + hue + '">' + ico(icon, 28) + '</div><div><h1>' + t + '</h1><p class="sub">' + sub + '</p></div></div>'; }

  // ---------- очистка ----------
  var CL = null;
  async function renderClean() {
    var el = $('p-clean'); el.innerHTML = head('trash', 350, 'Очистка диска', 'Ищу временные файлы и кэш…') + '<div class="skeleton">Сканирую диск, это может занять до минуты…</div>';
    var r = await opt.cleanScan(); if (page !== 'clean') return; CL = r.items || [];
    drawClean();
  }
  function drawClean() {
    var el = $('p-clean'), total = CL.reduce(function (a, c) { return a + c.size; }, 0);
    el.innerHTML = head('trash', 350, 'Очистка диска', total > 1e6 ? 'Можно освободить около ' + bytes(total) : 'Диск чистый, мусора почти нет') +
      '<div class="rows">' + CL.map(function (c) {
        return '<label class="row chk"><div class="rt"><b>' + esc(c.title) + '</b><p>' + (c.size > 0 ? bytes(c.size) : 'Пусто') + '</p></div><div class="rc"><input type="checkbox" data-clean="' + c.id + '" ' + (c.size > 1e6 ? 'checked' : '') + (c.size > 0 ? '' : ' disabled') + '><span class="cb"></span></div></label>';
      }).join('') + '</div><div class="cbar"><span id="cSel"></span><button class="btn big" data-act="cleanrun">Очистить выбранное</button></div><p class="hint">Удаляются только временные файлы и кэши. Браузеры лучше закрыть, тогда очистится больше. Личные файлы не затрагиваются.</p>';
    updClean();
  }
  function selClean() { var ids = [], sum = 0; document.querySelectorAll('[data-clean]:checked').forEach(function (i) { ids.push(i.dataset.clean); sum += (CL.filter(function (c) { return c.id === i.dataset.clean; })[0] || {}).size || 0; }); return { ids: ids, sum: sum }; }
  function updClean() { var s = selClean(); if ($('cSel')) $('cSel').textContent = 'Выбрано: ' + bytes(s.sum); }
  document.addEventListener('change', function (e) { if (e.target.dataset && e.target.dataset.clean) updClean(); });

  // ---------- журнал ----------
  var ACT = { apply: 'Включено', revert: 'Возвращено', run: 'Выполнено', clean: 'Очистка', kill: 'Процесс закрыт', 'startup-on': 'Включён в автозагрузке', 'startup-off': 'Убран из автозагрузки' };
  async function renderLog() {
    var el = $('p-log'), r = await opt.log(); if (page !== 'log') return;
    var applied = r.applied || [];
    el.innerHTML = head('list', 45, 'Журнал изменений', 'Всё, что программа сделала с твоим компьютером') +
      (applied.length ? '<div class="cbar"><span>Сейчас применено оптимизаций: ' + applied.length + '</span><button class="btn" data-act="revertall">' + ico('undo', 16) + 'Вернуть всё как было</button></div>' : '') +
      ((r.log || []).length ? '<div class="rows">' + r.log.slice(0, 80).map(function (l) {
        var extra = l.action === 'clean' && l.msg ? ' · освобождено ' + bytes(+l.msg) : (!l.ok && l.msg ? ' · ' + esc(l.msg) : '');
        return '<div class="row lg ' + (l.ok ? '' : 'fail') + '"><div class="rt"><b>' + esc(l.title) + '</b><p>' + (ACT[l.action] || l.action) + extra + '</p></div><div class="rc"><span class="when">' + tm(l.at) + '</span>' + (l.ok ? '' : '<span class="bd warn">Ошибка</span>') + '</div></div>';
      }).join('') + '</div>' : '<p class="hint">Пока пусто. Здесь появятся все изменения.</p>');
  }

  // ---------- действия ----------
  async function setTweak(id, on) {
    var t = tw(id); if (!t || busy[id]) return;
    busy[id] = 1; refresh();
    var r = await (on ? opt.apply(id) : opt.revert(id));
    busy[id] = 0;
    if (r && r.ok) { toast((on ? 'Включено: ' : 'Возвращено: ') + t.title, true); } else toast((r && r.msg) || 'Не получилось', false);
    await load(true); refresh();
  }
  function refresh() { if (page === 'home') renderHome(); else if (page.indexOf('cat:') === 0) renderCat(page.slice(4)); }

  document.addEventListener('click', async function (e) {
    var g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
    var k = e.target.closest('.kill');
    if (k) {
      if (!confirm('Закрыть процесс «' + k.dataset.name + '»? Несохранённые данные в нём пропадут.')) return;
      var rr = await opt.kill(+k.dataset.pid, k.dataset.name); toast(rr.ok ? 'Процесс закрыт' : (rr.msg || 'Не получилось'), !!rr.ok); return;
    }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = b.dataset.act, id = b.dataset.id;
    if (a === 'reload') { data = null; return go(page); }
    if (a === 'wizard') return wizard();
    if (a === 'toggle') { var t = tw(id); return setTweak(id, !t.applied); }
    if (a === 'choice') { var c = tw(id); if (!c.applied) return setTweak(id, true); return; }
    if (a === 'run') {
      var m = tw(id); if (m.confirm && !confirm(m.confirm)) return;
      busy[id] = 1; refresh(); var r = await opt.apply(id); busy[id] = 0; toast(r.msg || (r.ok ? 'Готово' : 'Не получилось'), !!r.ok); refresh(); return;
    }
    if (a === 'su') {
      var s = SU.filter(function (x) { return x.id === id; })[0], en = !s.enabled; b.classList.add('wait');
      var rs = await opt.startupSet(id, en); if (rs.ok) { s.enabled = en; toast((en ? 'Включено в автозагрузке: ' : 'Убрано из автозагрузки: ') + s.name, true); } else toast(rs.msg || 'Не получилось', false);
      if (page === 'startup') renderStartup(); return;
    }
    if (a === 'cleanrun') {
      var sel = selClean(); if (!sel.ids.length) { toast('Ничего не выбрано', false); return; }
      b.disabled = true; b.textContent = 'Очищаю…'; var rc = await opt.cleanRun(sel.ids, sel.sum);
      toast(rc.ok ? 'Готово, освобождено около ' + bytes(sel.sum) : 'Не всё удалось очистить', !!rc.ok); renderClean(); return;
    }
    if (a === 'revertall') {
      if (!confirm('Вернуть все изменения, которые сделала программа?')) return;
      var lg = await opt.log(), n = 0;
      for (var i = 0; i < lg.applied.length; i++) { var rv = await opt.revert(lg.applied[i]); if (rv.ok) n++; }
      await load(true); toast('Возвращено оптимизаций: ' + n, true); renderLog(); return;
    }
  });

  // ---------- мастер «Проверить и ускорить» ----------
  async function wizard() {
    busy.wizard = 1;
    modal('<div class="wz"><div class="spin"></div><h2>Проверяю компьютер…</h2><p class="sub">Смотрю, что включено, и считаю мусор</p></div>');
    var res = await Promise.all([load(true), opt.cleanScan()]);
    var cl = res[1].items || [], junk = cl.reduce(function (a, c) { return a + c.size; }, 0);
    var rec = data.items.filter(function (t) { return t.rec && t.kind === 'toggle' && !t.applied && !t.hide && (!t.laptop || data.laptop); });
    if (!rec.length && junk < 5e7) { busy.wizard = 0; modal('<div class="wz"><div class="okc">' + ico('check', 34) + '</div><h2>Всё уже хорошо</h2><p class="sub">Рекомендованные оптимизации включены, мусора почти нет.</p><div class="mbtn"><button class="btn" data-act="close">Закрыть</button></div></div>'); busy.wizard = 0; return; }
    busy.wizard = 0;
    modal('<div class="wz2"><h2>Вот что мы нашли</h2><p class="sub">Сними галочки с того, что не нужно. Перед изменениями создадим точку восстановления.</p><div class="wlist">' +
      rec.map(function (t) { return '<label class="wi"><input type="checkbox" data-w="' + t.id + '" checked><span class="cb"></span><div><b>' + esc(t.title) + '</b><span>' + esc(t.effect) + '</span></div></label>'; }).join('') +
      (junk >= 5e7 ? '<label class="wi"><input type="checkbox" data-wclean="1" checked><span class="cb"></span><div><b>Очистить мусор: ' + bytes(junk) + '</b><span>Временные файлы, кэш обновлений и браузеров, корзина</span></div></label>' : '') +
      '</div><div class="mbtn"><button class="btn ghost" data-act="close">Отмена</button><button class="btn big" data-act="wzgo">Применить</button></div></div>');
    window.__wz = { cl: cl, junk: junk };
  }
  async function wizardRun() {
    var ids = [].slice.call(document.querySelectorAll('[data-w]:checked')).map(function (i) { return i.dataset.w; });
    var doClean = !!document.querySelector('[data-wclean]:checked'), cl = window.__wz.cl, junk = window.__wz.junk;
    if (!ids.length && !doClean) { closeModal(); return; }
    busy.wizard = 1;
    var steps = ['Создаю точку восстановления'].concat(ids.map(function (i) { return tw(i).title; })).concat(doClean ? ['Очищаю мусор'] : []);
    function draw(n, results) {
      modal('<div class="wz2"><h2>Применяю…</h2><div class="wlist">' + steps.map(function (s, i) {
        var st = i < n ? (results[i] === false ? 'bad' : 'done') : i === n ? 'now' : '';
        return '<div class="wp ' + st + '"><i>' + (st === 'done' ? ico('check', 14) : st === 'bad' ? '!' : '') + '</i><b>' + esc(s) + '</b></div>';
      }).join('') + '</div></div>');
    }
    var results = [], n = 0; draw(0, results);
    var rp = await opt.restorePoint(); results.push(rp.ok); n++; draw(n, results);
    var okIds = [];
    for (var i = 0; i < ids.length; i++) { draw(n, results); var r = await opt.apply(ids[i]); results.push(!!r.ok); if (r.ok) okIds.push(ids[i]); n++; }
    var freed = 0;
    if (doClean) { draw(n, results); var sel = cl.filter(function (c) { return c.size > 0; }); var rc = await opt.cleanRun(sel.map(function (c) { return c.id; }), junk); results.push(!!rc.ok); if (rc.ok) freed = junk; n++; }
    draw(n, results); await load(true);
    var fails = results.filter(function (x) { return x === false; }).length - (rp.ok ? 0 : 1);
    busy.wizard = 0;
    modal('<div class="wz2"><div class="okc">' + ico('check', 34) + '</div><h2>Готово!</h2><p class="sub">Вот что изменилось:</p><div class="wlist">' +
      okIds.map(function (id) { var t = tw(id); return '<div class="wp done"><i>' + ico('check', 14) + '</i><div><b>' + esc(t.title) + '</b><span>' + esc(t.effect) + '</span></div></div>'; }).join('') +
      (freed ? '<div class="wp done"><i>' + ico('check', 14) + '</i><div><b>Очищено мусора: ' + bytes(freed) + '</b><span>Больше свободного места на диске</span></div></div>' : '') +
      '</div>' + (fails > 0 ? '<p class="hint">Не всё получилось (' + fails + '). Подробности в журнале. Попробуй запустить программу от имени администратора.</p>' : '') +
      (rp.ok ? '' : '<p class="hint">Точку восстановления Windows создать не дала, но все изменения можно вернуть кнопкой «Вернуть всё».</p>') +
      '<div class="mbtn"><button class="btn ghost" data-act="close" data-then="log">Журнал</button><button class="btn" data-act="close">Отлично</button></div></div>');
    if (page === 'home') renderHome();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'wzgo') wizardRun();
    if (b.dataset.act === 'close') { closeModal(); if (b.dataset.then) go(b.dataset.then); }
  });

  window.__start = function () { data = null; busy = {}; renderNav(); go('home'); };
  window.__reset = function () { data = null; SU = null; CL = null; document.querySelectorAll('.page').forEach(function (x) { if (x.id !== 'p-monitor') { x.innerHTML = ''; delete x.dataset.ready; } }); closeModal(); };
})();
