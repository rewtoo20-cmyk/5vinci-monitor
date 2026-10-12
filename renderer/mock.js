// Тестовые данные для проверки окна в обычном браузере (без Windows). В программе не используются.
(function () {
  var META = window.META, applied = {}, plan = 'plan_bal';
  ['gamemode', 'tips'].forEach(function (k) { applied[k] = true; });
  var startup = [
    { id: 'HKCU|Discord', name: 'Discord', cmd: 'C:\\Users\\me\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe', src: 'Реестр', enabled: true },
    { id: 'HKCU|Steam', name: 'Steam', cmd: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent', src: 'Реестр', enabled: true },
    { id: 'HKCU|Spotify', name: 'Spotify', cmd: 'C:\\Users\\me\\AppData\\Roaming\\Spotify\\Spotify.exe /minimized', src: 'Реестр', enabled: true },
    { id: 'HKLM|OneDrive', name: 'Microsoft OneDrive', cmd: '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background', src: 'Реестр', enabled: true },
    { id: 'HKLM|RtkAudUService', name: 'Realtek Audio', cmd: 'C:\\WINDOWS\\System32\\DriverStore\\RtkAudUService64.exe -background', src: 'Реестр', enabled: false },
    { id: 'HKCUF|Telegram.lnk', name: 'Telegram', cmd: 'C:\\Users\\me\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe', src: 'Папка автозагрузки', enabled: true },
  ];
  var clean = [['temp_user', 'Временные файлы пользователя', 1.4e9], ['temp_win', 'Временные файлы Windows', 380e6], ['wu_cache', 'Кэш обновлений Windows', 2.1e9], ['dx', 'Кэш шейдеров DirectX', 640e6], ['edge', 'Кэш браузера Edge', 910e6], ['chrome', 'Кэш браузера Chrome', 0], ['recycle', 'Корзина', 5.3e9]];
  var log = [];
  function wait(v, ms) { return new Promise(function (r) { setTimeout(function () { r(v); }, ms || 450); }); }
  function title(id) { var t = META.TWEAKS.filter(function (x) { return x.id === id; })[0]; return t ? t.title : id; }
  var licOk = !!(window.location.hash.indexOf('licensed') >= 0);
  var info = { id: 'abcd1234', name: 'Иван', plan: 'pro', exp: Date.now() + 29 * 864e5, bound: false };
  window.MOCK_LIC = {
    status: function () { return wait({ ok: licOk, info: licOk ? info : null, machine: '8CAE-A835-E408-A60A' }, 150); },
    activate: function (k) { if (/^VINCI\./.test(String(k).trim())) { licOk = true; return wait({ ok: true, info: info, machine: '8CAE-A835-E408-A60A' }, 400); } return wait({ ok: false, msg: 'Ключ не подошёл. Проверь, что скопировал его целиком', machine: '8CAE-A835-E408-A60A' }, 400); },
    logout: function () { licOk = false; return wait({ ok: true }, 100); },
    onLost: function () {},
  };
  window.MOCK_OPT = {
    catalog: function () {
      return wait({ ok: true, win: true, laptop: true, items: META.TWEAKS.map(function (t) {
        var a = null; if (t.kind === 'choice') a = (t.id === plan); else if (t.kind === 'toggle') a = !!applied[t.id];
        return Object.assign({}, t, { applied: a });
      }) }, 900);
    },
    apply: function (id) {
      var t = META.TWEAKS.filter(function (x) { return x.id === id; })[0];
      if (t.kind === 'choice') plan = id; else if (t.kind === 'toggle') applied[id] = true;
      log.unshift({ at: Date.now(), id: id, title: title(id), action: t.kind === 'action' ? 'run' : 'apply', ok: true });
      return wait({ ok: true, msg: 'Готово', action: t.kind === 'action' }, 700);
    },
    revert: function (id) { delete applied[id]; log.unshift({ at: Date.now(), id: id, title: title(id), action: 'revert', ok: true }); return wait({ ok: true }, 500); },
    log: function () { return wait({ log: log, applied: Object.keys(applied) }, 100); },
    startup: function () { return wait({ ok: true, list: startup }, 700); },
    startupSet: function (id, en) { startup.forEach(function (s) { if (s.id === id) s.enabled = en; }); log.unshift({ at: Date.now(), id: 'startup', title: id.split('|')[1], action: en ? 'startup-on' : 'startup-off', ok: true }); return wait({ ok: true }, 300); },
    cleanScan: function () { return wait({ ok: true, items: clean.map(function (c) { return { id: c[0], title: c[1], size: c[2] }; }) }, 1100); },
    cleanRun: function (ids, bytes) { clean = clean.map(function (c) { return ids.indexOf(c[0]) >= 0 ? [c[0], c[1], 0] : c; }); log.unshift({ at: Date.now(), id: 'clean', title: 'Очистка диска', action: 'clean', ok: true, msg: String(bytes) }); return wait({ ok: true }, 1200); },
    restorePoint: function () { return wait({ ok: true, msg: 'Точка восстановления создана' }, 800); },
    kill: function () { return wait({ ok: true }, 200); },
  };
})();
