// Окно: свой заголовок, вход по ключу
(function () {
  'use strict';
  var api = window.__api, $ = function (id) { return document.getElementById(id); };
  window.__locked = true;

  // кнопки окна
  $('wMin').onclick = function () { api.win.min(); };
  $('wMax').onclick = function () { api.win.max(); };
  $('wClose').onclick = function () { api.win.close(); };
  function showMax(m) { $('icMax').style.display = m ? 'none' : ''; $('icRes').style.display = m ? '' : 'none'; document.body.classList.toggle('maxed', !!m); $('wMax').title = m ? 'Свернуть в окно' : 'Развернуть'; }
  api.win.onState && api.win.onState(function (s) { showMax(s && s.max); });
  Promise.resolve(api.win.state()).then(function (s) { showMax(s && s.max); }).catch(function () {});

  // экран ключа
  var machine = '';
  function dt(ms) { return new Date(ms).toLocaleDateString('ru-RU'); }
  function licLine(info) {
    var el = $('licLine');
    if (!info) { el.innerHTML = ''; return; }
    var left = info.exp ? Math.ceil((info.exp + 864e5 - Date.now()) / 864e5) : 0;
    el.innerHTML = '<div class="lw"><b>' + (info.name ? String(info.name).replace(/[<>&"]/g, '') : 'Ключ активен') + '</b><span>' + (info.exp ? 'до ' + dt(info.exp) + (left <= 7 ? ' · осталось ' + left + ' дн.' : '') : 'бессрочно') + '</span></div><button id="licOut" class="btn sm ghost">Сменить ключ</button>';
    $('licOut').onclick = function () { if (confirm('Выйти из ключа? Чтобы войти снова, понадобится ключ.')) Promise.resolve(api.license.logout()).then(function () { window.__reset && window.__reset(); showLock(); }); };
  }
  function showLock(msg) {
    window.__locked = true; $('lock').hidden = false; licLine(null);
    $('keyErr').textContent = msg || ''; $('keyIn').value = '';
    Promise.resolve(api.license.status()).then(function (s) { machine = s.machine || ''; $('machId').textContent = machine || 'неизвестно'; }).catch(function () {});
    setTimeout(function () { $('keyIn').focus(); }, 50);
  }
  window.__showLock = showLock;
  function unlocked(s) {
    window.__locked = false; $('lock').hidden = true; licLine(s.info);
    window.__loadInfo && window.__loadInfo();
    window.__start && window.__start();
  }
  function submit() {
    var k = $('keyIn').value.trim(); if (!k) { $('keyErr').textContent = 'Вставь ключ'; return; }
    var b = $('keyGo'); b.disabled = true; b.textContent = 'Проверяю…'; $('keyErr').textContent = '';
    Promise.resolve(api.license.activate(k)).then(function (r) {
      b.disabled = false; b.textContent = 'Войти';
      if (r && r.machine) { machine = r.machine; $('machId').textContent = machine; }
      if (r && r.ok) unlocked(r); else $('keyErr').textContent = (r && r.msg) || 'Не получилось проверить ключ';
    }).catch(function () { b.disabled = false; b.textContent = 'Войти'; $('keyErr').textContent = 'Ошибка проверки'; });
  }
  $('keyGo').onclick = submit;
  $('keyIn').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  $('machCp').onclick = function () { try { navigator.clipboard.writeText(machine); $('machCp').textContent = 'Скопировано'; setTimeout(function () { $('machCp').textContent = 'Копировать'; }, 1500); } catch (e) {} };
  api.license.onLost && api.license.onLost(function () { window.__reset && window.__reset(); showLock('Срок действия ключа закончился'); });

  Promise.resolve(api.license.status()).then(function (s) {
    machine = s.machine || ''; $('machId').textContent = machine || 'неизвестно';
    if (s.ok) unlocked(s); else showLock();
  }).catch(function () { showLock('Не удалось проверить ключ'); });
})();
