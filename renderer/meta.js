// Описание оптимизаций: что видит пользователь. Сами команды лежат в tweaks.js.
(function (root) {
  var CATS = [
    { id: 'net', title: 'Интернет', sub: 'Быстрее сайты, меньше лишнего трафика', icon: 'wifi', hue: 205 },
    { id: 'power', title: 'Батарея и питание', sub: 'Дольше работать без зарядки', icon: 'bolt', hue: 140 },
    { id: 'perf', title: 'Производительность', sub: 'Игры и быстрый отклик системы', icon: 'rocket', hue: 28 },
    { id: 'svc', title: 'Службы Windows', sub: 'Отключить то, что работает зря', icon: 'gear', hue: 285 },
  ];
  var T = [
    { id: 'dns_cf', cat: 'net', kind: 'toggle', rec: true, risk: 'safe', title: 'Быстрый DNS (Cloudflare)', desc: 'Запросы к сайтам идут через DNS 1.1.1.1 вместо DNS провайдера. Это обычно ускоряет открытие страниц.', effect: 'Сайты открываются быстрее' },
    { id: 'do_off', cat: 'net', kind: 'toggle', rec: true, risk: 'safe', title: 'Не раздавать обновления Windows другим', desc: 'По умолчанию Windows может отдавать кусочки обновлений чужим компьютерам через твой интернет.', effect: 'Меньше фоновой нагрузки на сеть' },
    { id: 'flush_dns', cat: 'net', kind: 'action', risk: 'safe', title: 'Очистить кэш DNS', desc: 'Помогает, если сайт не открывается или показывает старую версию.', effect: 'Выполняется сразу', btn: 'Очистить' },
    { id: 'net_reset', cat: 'net', kind: 'action', risk: 'caution', reboot: true, title: 'Сбросить сетевые настройки', desc: 'Лечит странные проблемы с интернетом. Пароли Wi-Fi сохранятся, но нужна перезагрузка.', effect: 'Исправляет сбои сети', btn: 'Сбросить', confirm: 'Сбросить сетевые настройки? Потом нужно перезагрузить компьютер.' },

    { id: 'plan_saver', cat: 'power', kind: 'choice', group: 'plan', risk: 'safe', title: 'Экономия энергии', desc: 'Процессор и экран работают экономнее. Лучший вариант для работы от батареи.', effect: 'Дольше работает от батареи' },
    { id: 'plan_bal', cat: 'power', kind: 'choice', group: 'plan', risk: 'safe', title: 'Сбалансированный', desc: 'Золотая середина: скорость, когда нужна, и экономия, когда нет.', effect: 'Режим по умолчанию' },
    { id: 'plan_perf', cat: 'power', kind: 'choice', group: 'plan', risk: 'safe', title: 'Высокая производительность', desc: 'Максимум скорости. Расходует больше энергии, подходит для игр и работы от сети.', effect: 'Быстрее отклик, больше расход' },
    { id: 'batt30', cat: 'power', kind: 'toggle', rec: true, laptop: true, risk: 'safe', title: 'Экономия заряда с 30%', desc: 'Windows сама включит режим экономии, когда заряд упадёт до 30% (по умолчанию 20%).', effect: 'Ноутбук живёт дольше' },
    { id: 'bgapps', cat: 'power', kind: 'toggle', rec: true, risk: 'safe', title: 'Запретить приложениям работать в фоне', desc: 'Магазинные приложения не будут тихо работать, когда ты их не используешь.', effect: 'Меньше нагрузка и расход батареи' },

    { id: 'gamemode', cat: 'perf', kind: 'toggle', rec: true, risk: 'safe', title: 'Игровой режим Windows', desc: 'Во время игры система отдаёт ей приоритет и не мешает фоновыми задачами.', effect: 'Стабильнее FPS в играх' },
    { id: 'gamedvr', cat: 'perf', kind: 'toggle', rec: true, risk: 'safe', title: 'Отключить фоновую запись игр', desc: 'Xbox Game Bar записывает игру в фоне и отнимает часть мощности.', effect: 'Меньше просадок FPS' },
    { id: 'startdelay', cat: 'perf', kind: 'toggle', rec: true, risk: 'safe', title: 'Убрать задержку запуска программ', desc: 'Windows специально ждёт несколько секунд после входа, прежде чем запускать твои программы.', effect: 'Быстрее после включения ПК' },
    { id: 'tips', cat: 'perf', kind: 'toggle', rec: true, risk: 'safe', title: 'Отключить советы и рекламу Windows', desc: 'Убирает «рекомендации», рекламные плитки в меню Пуск и подсказки.', effect: 'Чище система, меньше фоновых запросов' },
    { id: 'fx', cat: 'perf', kind: 'toggle', risk: 'safe', title: 'Отключить прозрачность и анимации', desc: 'Окна открываются мгновенно, без плавных эффектов. Заметно на слабых компьютерах.', effect: 'Интерфейс отзывчивее' },

    { id: 'svc_telemetry', cat: 'svc', kind: 'toggle', rec: true, risk: 'safe', title: 'Телеметрия Windows', desc: 'Службы, которые собирают данные о твоём компьютере и отправляют в Microsoft.', effect: 'Меньше фоновой работы и трафика' },
    { id: 'svc_rare', cat: 'svc', kind: 'toggle', risk: 'safe', title: 'Редко нужные службы', desc: 'Факс, демо-режим магазина, офлайн-карты, общий доступ к медиа, удалённый реестр. Большинству не нужны.', effect: 'Освобождает немного памяти' },
    { id: 'svc_xbox', cat: 'svc', kind: 'toggle', risk: 'caution', title: 'Службы Xbox', desc: 'Нужны только приложению Xbox и некоторым играм из Microsoft Store. Для Steam не нужны.', effect: 'Освобождает память и процессор' },
    { id: 'svc_print', cat: 'svc', kind: 'toggle', risk: 'caution', title: 'Служба печати', desc: 'Отключай, только если у тебя нет принтера. Без неё печатать нельзя, в том числе в PDF.', effect: 'Освобождает немного памяти' },
    { id: 'svc_search', cat: 'svc', kind: 'toggle', risk: 'caution', title: 'Индексация поиска', desc: 'Windows постоянно сканирует файлы для быстрого поиска. Без неё поиск файлов станет медленнее.', effect: 'Меньше нагрузка на диск' },
  ];
  var api = { CATS: CATS, TWEAKS: T };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.META = api;
})(typeof window !== 'undefined' ? window : globalThis);
