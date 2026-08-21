/* ============================================================
   Полка — каталог домашней коллекции настольных игр
   Хранилище: localStorage. Данные об играх: api.tesera.ru
   ============================================================ */
'use strict';

/* ---------- Утилиты ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const plural = (n, a, b, c) => {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return a;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return b;
  return c;
};
const collator = new Intl.Collator('ru');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  // Не через requestAnimationFrame: в фоновой вкладке он не срабатывает,
  // и сообщение так и осталось бы прозрачным.
  void t.offsetWidth;
  t.classList.add('in');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => { t.hidden = true; }, 320);
  }, 2000);
}

/* ---------- Хранилище ---------- */
const KEY = 'polka.v1';

const KINDS = {
  room:      { label: 'Комната',  childLabel: 'мебель',  childKind: 'furniture', icon: '🚪' },
  furniture: { label: 'Мебель',   childLabel: 'место',   childKind: 'spot',      icon: '🗄️' },
  spot:      { label: 'Место',    childLabel: null,      childKind: null,        icon: '📍' },
};

const ICONS = {
  room:      ['🛋️', '🛏️', '🍳', '🚪', '🧸', '🚿', '💼', '🪟', '🏠', '🧺', '🚗', '🌿'],
  furniture: ['🗄️', '📚', '🪑', '🛏️', '📦', '🧳', '🪟', '🚪', '🧰', '🛒', '🪆', '🗃️'],
  spot:      ['📍', '⬆️', '⬇️', '↔️', '📦', '🧺', '🕳️', '🔝', '🔻', '🗂️', '🎁', '🧱'],
};

const PRESET_TAGS = ['для компании', 'на двоих', 'семейная', 'детская', 'пати',
  'кооператив', 'евро', 'америтреш', 'филлер', 'тяжёлая', 'для новичков',
  'детектив', 'карточная', 'абстракт', 'дуэльная', 'на вечер'];

let S = load();

function blank() {
  // trash — «надгробия» удалённых записей: без них удаление на одном
  // устройстве откатывалось бы обратно при слиянии с другим.
  return { v: 1, places: [], games: [], trash: {}, seenIntro: false };
}

const now = () => Date.now();

// Любое изменение записи помечается временем — на этом держится слияние.
function touch(o) { o.updatedAt = now(); return o; }

function bury(id) {
  S.trash = S.trash || {};
  S.trash[id] = now();
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const d = JSON.parse(raw);
    return { ...blank(), ...d };
  } catch (e) {
    console.warn('Не удалось прочитать хранилище:', e);
    return blank();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {
    toast('Не хватает места в хранилище');
    console.error(e);
  }
  if (typeof schedulePush === 'function') schedulePush();
}

/* ============================================================
   СИНХРОНИЗАЦИЯ

   Общее хранилище — секретный gist на GitHub. Сервера нет, платить не за что.
   Читается он по одному лишь номеру, пишется только с токеном.

   Слияние идёт по каждой записи отдельно, а не «чей файл новее»: иначе жена,
   добавившая игру с телефона, затёрла бы всё, что ты успел поправить на Маке.
   У каждой игры и каждого места есть updatedAt, у удалённых — надгробие в trash.
   ============================================================ */
const CFG_KEY = 'polka.sync';
const GIST_FILE = 'polka.json';
const TRASH_TTL = 90 * 24 * 3600 * 1000;   // надгробия старше трёх месяцев не нужны

let syncState = { busy: false, at: 0, error: null };

// Объявлена через function, а не const: loadCfg вызывается выше по файлу,
// и стрелочная функция к тому моменту ещё не существует.
// Невидимое (пробелы, неразрывный пробел, нулевой ширины, BOM) цепляется
// при копировании из веба само — вычищаем и не беспокоим человека.
function cleanToken(t) {
  return String(t || '').replace(/[\s ​-‍﻿]/g, '');
}

function loadCfg() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(CFG_KEY));
  } catch (e) {
    console.error('Настройки синхронизации не читаются:', e);
  }
  // Чистка снаружи try: ошибка в коде должна падать громко, а не приводить
  // к тихой потере токена — именно так синхронизация и слетала.
  const c = (raw && typeof raw === 'object') ? raw : {};
  if (c.token) c.token = cleanToken(c.token);
  return c;
}

let cfg = loadCfg();
function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

const syncOn = () => !!(cfg.gistId);
const canWrite = () => !!(cfg.gistId && cfg.token);

/* --- Код подключения: номер gist и токен в одной строке --- */
function makeCode() {
  const raw = `${cfg.gistId}:${cfg.token || ''}`;
  return btoa(unescape(encodeURIComponent(raw))).replace(/=+$/, '');
}
function parseCode(code) {
  try {
    const raw = decodeURIComponent(escape(atob(code.trim())));
    const i = raw.indexOf(':');
    if (i < 0) return null;
    const gistId = cleanToken(raw.slice(0, i)), token = cleanToken(raw.slice(i + 1));
    return /^[0-9a-f]{16,}$/i.test(gistId) ? { gistId, token } : null;
  } catch { return null; }
}
const inviteLink = () => `${location.origin}${location.pathname}#/connect/${makeCode()}`;

// Приложение с домашнего экрана на iOS живёт в своём хранилище, отдельном
// от Safari, и ссылка-приглашение туда не долетает. Поэтому код нужно уметь
// принимать вставкой — хоть ссылкой целиком, хоть голым кодом.
function parseInvite(text) {
  const s = String(text || '').trim();
  const m = s.match(/#\/connect\/([A-Za-z0-9+/=_-]+)/);
  return parseCode(m ? m[1] : s);
}

/* --- Чтение и запись gist --- */
/* Чистка токена — выше, рядом с loadCfg: она нужна ещё при загрузке. */

function checkToken(t) {
  if (!t) return null;
  const bad = [...t].find(ch => !/[A-Za-z0-9_.-]/.test(ch));
  if (!bad) return null;
  // Русская раскладка — главная ловушка: «с», «р», «а», «е» неотличимы на вид.
  if (/[Ѐ-ӿ]/.test(bad))
    return `В токене русская буква «${bad}» — вставь его заново копированием`;
  return `В токене посторонний символ «${bad}» — вставь его заново`;
}

async function gistRead() {
  const bad = checkToken(cfg.token);
  if (bad) throw new Error(bad);
  const r = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
    headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(r.status === 404 ? 'Хранилище не найдено' : `GitHub ответил ${r.status}`);
  const d = await r.json();
  const f = d.files && d.files[GIST_FILE];
  if (!f) return blank();
  // Файлы больше мегабайта приходят обрезанными — их надо дочитать по прямой ссылке.
  const text = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
  try { return { ...blank(), ...JSON.parse(text) }; }
  catch { return blank(); }
}

async function gistWrite(data) {
  const r = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(data) } } }),
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error('Токен не подошёл — проверь в Ещё');
    if (r.status === 403) throw new Error('У токена нет права gist');
    if (r.status === 404) throw new Error('Хранилище не найдено или токен чужой');
    throw new Error(`Не удалось записать (${r.status})`);
  }
}

/* --- Слияние двух состояний --- */
function mergeStates(a, b) {
  const trash = {};
  const cut = now() - TRASH_TTL;
  for (const src of [a.trash || {}, b.trash || {}])
    for (const [id, t] of Object.entries(src))
      if (t > cut) trash[id] = Math.max(trash[id] || 0, t);

  const mergeList = (x = [], y = []) => {
    const m = new Map();
    for (const it of [...x, ...y]) {
      if (!it || !it.id) continue;
      const prev = m.get(it.id);
      if (!prev || (it.updatedAt || 0) >= (prev.updatedAt || 0)) m.set(it.id, it);
    }
    // Удаление побеждает только если оно новее последней правки записи.
    return [...m.values()].filter(it => !(trash[it.id] >= (it.updatedAt || 0)));
  };

  return {
    v: 1,
    games: mergeList(a.games, b.games),
    places: mergeList(a.places, b.places),
    trash,
  };
}

const fingerprint = d => JSON.stringify({
  g: (d.games || []).map(x => [x.id, x.updatedAt || 0]).sort(),
  p: (d.places || []).map(x => [x.id, x.updatedAt || 0]).sort(),
  t: Object.entries(d.trash || {}).sort(),
});

async function syncNow({ silent = false } = {}) {
  if (!syncOn() || syncState.busy) return;
  syncState.busy = true; syncState.error = null;
  if (!silent) renderSyncRow();

  try {
    const remote = await gistRead();
    const merged = mergeStates(S, remote);

    if (fingerprint(merged) !== fingerprint(S)) {
      // Запись приехавшего — не повод тут же слать всё обратно.
      syncState.applying = true;
      Object.assign(S, merged);
      save();
      syncState.applying = false;
      render();
    }
    if (canWrite() && fingerprint(merged) !== fingerprint(remote)) {
      await gistWrite(merged);
    }

    syncState.at = now();
    cfg.lastSync = syncState.at; saveCfg();
    if (!silent) toast('Синхронизировано');
  } catch (e) {
    syncState.error = e.message;
    console.warn('sync', e);
    // О поломке нужно узнавать сразу, а не через неделю, обнаружив, что
    // телефон жены живёт своей жизнью. Один раз на каждую новую ошибку.
    if (!silent || syncState.shown !== e.message) {
      toast(e.message);
      syncState.shown = e.message;
    }
  } finally {
    syncState.busy = false;
    renderSyncRow();
    markSyncHealth();
  }
}

// Точка на вкладке «Ещё», пока обмен сломан.
function markSyncHealth() {
  const bad = syncOn() && !!syncState.error;
  $$('[data-tab="settings"]').forEach(el => el.classList.toggle('sync-bad', bad));
}

// Локальные правки уезжают не мгновенно, а пачкой: пока человек щёлкает
// теги, дёргать сеть на каждый тап незачем.
let pushTimer = null;
function schedulePush() {
  if (!syncOn() || syncState.applying) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow({ silent: true }), 2500);
}

function renderSyncRow() {
  const el = $('#sync-status');
  if (!el) return;
  el.textContent = syncState.busy ? 'Обмен…'
    : syncState.error ? syncState.error
    : cfg.lastSync ? `Обновлено ${agoStr(cfg.lastSync)}`
    : 'Ещё не синхронизировалось';
}

function agoStr(t) {
  const s = Math.round((now() - t) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  return `${Math.round(s / 86400)} дн назад`;
}

/* ---------- Операции с местами ---------- */
const place = id => S.places.find(p => p.id === id) || null;
const childrenOf = id => S.places.filter(p => p.parentId === id)
  .sort((a, b) => collator.compare(a.name, b.name));

function pathOf(id) {
  const out = [];
  let p = place(id);
  let guard = 0;
  while (p && guard++ < 20) { out.unshift(p); p = p.parentId ? place(p.parentId) : null; }
  return out;
}
const pathStr = (id, sep = ' › ') => pathOf(id).map(p => p.name).join(sep);

function descendantIds(id) {
  const out = [id];
  const walk = pid => childrenOf(pid).forEach(c => { out.push(c.id); walk(c.id); });
  walk(id);
  return out;
}

function gamesIn(id, deep = true) {
  const ids = deep ? new Set(descendantIds(id)) : new Set([id]);
  return S.games.filter(g => ids.has(g.placeId));
}

function addPlace(parentId, kind, name, icon) {
  const p = touch({ id: uid(), parentId: parentId || null, kind, name: name.trim(), icon: icon || KINDS[kind].icon });
  S.places.push(p); save();
  return p;
}

function removePlace(id) {
  const ids = new Set(descendantIds(id));
  S.games.forEach(g => { if (ids.has(g.placeId)) { g.placeId = null; touch(g); } });
  S.places = S.places.filter(p => !ids.has(p.id));
  ids.forEach(bury);
  save();
}

/* ---------- Операции с играми ---------- */
const game = id => S.games.find(g => g.id === id) || null;

function allTags() {
  const set = new Set();
  S.games.forEach(g => (g.tags || []).forEach(t => set.add(t)));
  return [...set].sort(collator.compare);
}

function saveGame(g) {
  touch(g);
  const i = S.games.findIndex(x => x.id === g.id);
  if (i >= 0) S.games[i] = g; else S.games.push(g);
  save();
}

function removeGame(id) {
  S.games = S.games.filter(g => g.id !== id);
  bury(id);
  save();
}

/* ============================================================
   НАСТРОЕНИЕ ИГРЫ

   Категории выводятся из данных Тесеры, а не спрашиваются у человека:
   грузить вопросами при добавлении игры — верный способ бросить каталог
   на пятой коробке. Если автомат ошибся, в карточке игры можно
   перещёлкнуть вручную — своя пометка всегда важнее вычисленной.
   ============================================================ */
const VIBES = [
  { id: 'family', icon: '👨‍👩‍👧', label: 'Всей семьёй',      sub: 'С детьми, правила за пять минут' },
  { id: 'brains', icon: '🧠',      label: 'Битва умов',       sub: 'Сесть и думать, вдвоём-вчетвером' },
  { id: 'geek',   icon: '🐙',      label: 'Гик-тусовка',      sub: 'Свои люди, толстая коробка не пугает' },
  { id: 'crowd',  icon: '🎉',      label: 'Большой компанией', sub: 'Пятеро и больше' },
  { id: 'party',  icon: '🍻',      label: 'Пьянка',           sub: 'Шумно, быстро, без правил на двадцать страниц' },
];
const vibe = id => VIBES.find(v => v.id === id);

// 0 — лёгкая, 1 — средняя, 2 — тяжёлая
function complexityOf(g) {
  const learn = g.timeToLearn || 0;
  if (learn) return learn <= 7 ? 0 : learn <= 20 ? 1 : 2;
  const t = g.playtimeMax || g.playtimeMin || 0;   // старые карточки без timeToLearn
  if (!t) return 1;
  return t <= 30 ? 0 : t <= 90 ? 1 : 2;
}
const COMPLEXITY_LABEL = ['лёгкая', 'средняя', 'тяжёлая'];

function autoVibes(g) {
  const c = complexityOf(g);
  const age = g.ageMin || 0;
  const maxP = g.playersMax || 0;
  const t = g.playtimeMax || g.playtimeMin || 0;
  const out = new Set();

  if (age && age <= 10 && c <= 1) out.add('family');
  if (c >= 1 && maxP && maxP <= 5) out.add('brains');
  if (c >= 2) out.add('geek');
  if (maxP >= 6) out.add('crowd');
  if (maxP >= 5 && c === 0 && t && t <= 30) { out.add('party'); out.add('crowd'); }

  if (!out.size) out.add(c >= 2 ? 'geek' : 'brains');
  return [...out];
}

const vibesOf = g => (g.vibes && g.vibes.length) ? g.vibes : autoVibes(g);
const vibeIsManual = g => !!(g.vibes && g.vibes.length);

/* ---------- Форматирование ---------- */
// Tesera отдаёт превью нужного размера, если вставить его в путь.
// Полноразмерные обложки весят под мегабайт — в сетке они не нужны.
function thumb(url, px) {
  if (!url) return '';
  return url.replace(/(\/images\/items\/[^/]+\/)(?!\d+x\d+x)/, `$1${px}x${px}xpa/`);
}

function playersStr(g) {
  const a = g.playersMin, b = g.playersMax;
  if (!a && !b) return '—';
  if (!b || a === b) return String(a || b);
  return `${a}–${b}`;
}
function timeStr(g) {
  const a = g.playtimeMin, b = g.playtimeMax;
  if (!a && !b) return '—';
  if (!b || a === b) return `${a || b}′`;
  return `${a}–${b}′`;
}
function whereStr(g) {
  if (g.lentTo) return `🤝 у ${g.lentTo}`;
  if (!g.placeId || !place(g.placeId)) return 'место не указано';
  return pathStr(g.placeId);
}

// Под обложкой важнее последний, самый конкретный уровень: искать нужно там.
function whereShort(g) {
  if (g.lentTo) return `🤝 у ${g.lentTo}`;
  const chain = g.placeId ? pathOf(g.placeId) : [];
  if (!chain.length) return 'место не указано';
  const room = chain[0], leaf = chain[chain.length - 1];
  return chain.length === 1 ? `${room.icon} ${room.name}` : `${room.icon} ${leaf.name}`;
}

/* ---------- API Tesera ---------- */
const TESERA = 'https://api.tesera.ru';

async function teseraSearch(q) {
  const r = await fetch(`${TESERA}/search/games?query=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('search ' + r.status);
  const d = await r.json();
  return (Array.isArray(d) ? d : []).filter(x => x.type === 'Game');
}

// При добавлении списком выбирать нужно осмысленно: у Tesera первым в выдаче
// нередко идёт дополнение или тёзка, а не сама игра («Сквозь века» → «Таймлайн Твист»).
const normTitle = s => String(s || '').toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/,\s*\d{4}\s*$/, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

function bestHit(hits, query) {
  const q = normTitle(query);
  if (!q) return hits[0];

  const score = h => {
    const t = normTitle(h.title || h.value), t2 = normTitle(h.title2);
    const extra = Math.max(0, t.split(' ').length - q.split(' ').length);
    if (t === q) return 100;
    if (t2 && t2 === q) return 90;
    if (t.startsWith(q + ' ')) return 60 - extra;
    if (t2 && t2.startsWith(q + ' ')) return 50 - extra;
    if (t.includes(q) || (t2 && t2.includes(q))) return 30 - extra;
    return 10 - extra;
  };

  return hits.reduce((best, h) => score(h) > score(best) ? h : best, hits[0]);
}

async function teseraGame(alias) {
  const r = await fetch(`${TESERA}/games/${encodeURIComponent(alias)}`);
  if (!r.ok) throw new Error('game ' + r.status);
  const d = await r.json();
  return d.game || null;
}

function fromTesera(t) {
  return {
    id: uid(),
    title: t.title || t.value || 'Без названия',
    titleOrig: (t.title2 && !/^\d{4}/.test(t.title2)) ? t.title2.replace(/,\s*\d{4}\s*$/, '') : '',
    alias: t.alias || '',
    teseraId: t.teseraId || null,
    bggId: t.bggId || null,
    photoUrl: (t.photoUrl || '').replace(/\/\d+x\d+x[a-z]+\//, '/'),
    year: t.year || null,
    playersMin: t.playersMin || null,
    playersMax: t.playersMax || null,
    playersRecMin: t.playersMinRecommend || null,
    playersRecMax: t.playersMaxRecommend || null,
    ageMin: t.playersAgeMin || null,
    playtimeMin: t.playtimeMin || null,
    playtimeMax: t.playtimeMax || null,
    timeToLearn: t.timeToLearn || null,   // минуты на объяснение правил — главный признак сложности
    rating: t.bggGeekRating || t.ratingUser || null,
    tags: [],
    placeId: null,
    note: '',
    lentTo: '',
    addedAt: Date.now(),
  };
}

/* ---------- Шторка ---------- */
const layer = $('#sheet-layer'), sheetBody = $('#sheet-body');
let sheetStack = [];

function openSheet(html, onMount) {
  sheetBody.onclick = null;   // сбрасываем делегат предыдущей шторки
  sheetBody.innerHTML = html;
  sheetBody.scrollTop = 0;
  layer.hidden = false;
  // Всегда возвращаем класс: иначе отложенное скрытие после closeSheet
  // успеет стереть только что открытую шторку.
  if (!layer.classList.contains('in')) { void layer.offsetWidth; layer.classList.add('in'); }
  if (onMount) onMount(sheetBody);
}

function closeSheet() {
  sheetStack = [];
  layer.classList.remove('in');
  setTimeout(() => { if (!layer.classList.contains('in')) { layer.hidden = true; sheetBody.innerHTML = ''; } }, 360);
}

$('#sheet-scrim').addEventListener('click', closeSheet);
$('#sheet-grab').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !layer.hidden) closeSheet(); });

const sheetHead = (title, backFn) => `
  <div class="sh-head">
    ${backFn ? `<button class="sh-close" data-sh-back>‹</button>` : ''}
    <div class="sh-title">${esc(title)}</div>
    <button class="sh-close" data-sh-close>✕</button>
  </div>`;

sheetBody.addEventListener('click', e => {
  if (e.target.closest('[data-sh-close]')) closeSheet();
});

/* ============================================================
   ЭКРАНЫ
   ============================================================ */
const view = $('#view'), main = $('#main');
const scrollMem = {};

function go(hash) { location.hash = hash; }

function render() {
  const raw = (location.hash || '#/collection').slice(2);
  const [route, arg] = raw.split('/');

  // Приглашение с другого устройства приходит обычной ссылкой.
  if (route === 'connect' && arg) { openConnect(arg); return render(); }

  $$('[data-tab]').forEach(el => el.classList.toggle('on',
    el.dataset.tab === route || (route === 'place' && el.dataset.tab === 'home')));

  $('#sb-count-games').textContent = S.games.length || '';
  $('#sb-count-places').textContent = S.places.filter(p => p.kind === 'room').length || '';

  const views = { collection: viewCollection, home: viewHome, place: viewPlace, pick: viewPick, settings: viewSettings };
  const fn = views[route] || viewCollection;
  view.innerHTML = fn(arg);
  main.scrollTop = scrollMem[raw] || 0;
  updateStuck();
  renderSyncRow();
  markSyncHealth();
}

window.addEventListener('hashchange', () => {
  render();
});
main.addEventListener('scroll', () => {
  scrollMem[(location.hash || '#/collection').slice(2)] = main.scrollTop;
  updateStuck();
}, { passive: true });

function updateStuck() {
  const h = $('.hdr', view);
  if (h) h.classList.toggle('stuck', main.scrollTop > 6);
}

/* ---------- Коллекция ---------- */
const cState = { q: '', tags: new Set(), sort: 'title' };

function collectionList() {
  let list = S.games.slice();

  if (cState.q.trim()) {
    const q = cState.q.trim().toLowerCase();
    list = list.filter(g =>
      (g.title || '').toLowerCase().includes(q) ||
      (g.titleOrig || '').toLowerCase().includes(q) ||
      (g.tags || []).some(t => t.toLowerCase().includes(q)) ||
      whereStr(g).toLowerCase().includes(q));
  }
  if (cState.tags.size) list = list.filter(g => [...cState.tags].every(t => (g.tags || []).includes(t)));

  const sorters = {
    title:  (a, b) => collator.compare(a.title, b.title),
    recent: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  };
  return list.sort(sorters[cState.sort]);
}

function viewCollection() {
  const tags = allTags();
  const list = collectionList();

  if (!S.games.length) return header('Коллекция', '') + emptyStart();

  return header('Коллекция', `${S.games.length} ${plural(S.games.length, 'игра', 'игры', 'игр')}`, null, null,
    `<button class="hdr-btn" data-act="random-any" aria-label="Случайная игра" title="Случайная игра">🎲</button>`) + `
    <div class="searchbar">
      <input type="search" id="c-q" placeholder="Название, тег или место" value="${esc(cState.q)}"
             autocomplete="off" autocorrect="off" spellcheck="false">
    </div>
    <div class="chips scroll">
      <button class="chip ${cState.sort === 'title' ? 'on' : ''}" data-sort="title">А–Я</button>
      <button class="chip ${cState.sort === 'recent' ? 'on' : ''}" data-sort="recent">Новые</button>
      <button class="chip ${cState.sort === 'rating' ? 'on' : ''}" data-sort="rating">Рейтинг</button>
      ${tags.length ? '<span style="width:6px"></span>' : ''}
      ${tags.map(t => `<button class="chip ${cState.tags.has(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    ${list.length ? gridHtml(list) : `
      <div class="empty">
        <div class="empty-ico">🔍</div>
        <div class="empty-title">Ничего не нашлось</div>
        <div class="empty-text">Попробуй другой запрос или сбрось фильтры.</div>
      </div>`}
  `;
}

function gridHtml(list, showWhere = true) {
  return `<div class="grid">${list.map((g, i) => gcard(g, showWhere, i)).join('')}</div>`;
}

function gcard(g, showWhere = true, i = 0) {
  const art = g.photoUrl
    ? `<img src="${esc(thumb(g.photoUrl, 400))}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'gcard-ph',textContent:'🎲'}))">`
    : `<div class="gcard-ph">🎲</div>`;
  return `
    <button class="gcard" data-game="${g.id}" style="animation-delay:${Math.min(i, 14) * 18}ms">
      <div class="gcard-art">
        ${art}
        ${g.playersMin ? `<span class="gcard-badge">${esc(playersStr(g))}👤</span>` : ''}
        ${g.lentTo ? `<div class="gcard-lent">🤝<br>у ${esc(g.lentTo)}</div>` : ''}
      </div>
      <div class="gcard-name">${esc(g.title)}</div>
      ${showWhere ? `<div class="gcard-where">${esc(whereShort(g))}</div>` : ''}
    </button>`;
}

function header(title, sub, backHref, backLabel, actions = '') {
  return `<div class="hdr">
    ${backHref ? `<a class="back-btn" href="${backHref}"><span class="chev">‹</span>${esc(backLabel || 'Назад')}</a>` : ''}
    <div class="hdr-row"><h1 class="hdr-title">${esc(title)}</h1>${actions}</div>
    ${sub ? `<div class="hdr-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

function emptyStart() {
  return `<div class="empty">
    <div class="empty-ico">🎲</div>
    <div class="empty-title">Пока пусто</div>
    <div class="empty-text">Добавь первую игру — название подтянется с Tesera вместе с обложкой, числом игроков и временем партии.</div>
    <button class="btn" data-act="add-game">＋ Добавить игру</button>
    ${syncOn() ? '' : `<button class="btn ghost" data-act="sync-setup" style="margin-top:10px">У меня уже есть коллекция</button>`}
    <button class="btn ghost" data-act="demo" style="margin-top:10px">Заполнить примером</button>
  </div>`;
}

/* ---------- Квартира ---------- */
function viewHome() {
  const rooms = S.places.filter(p => p.kind === 'room').sort((a, b) => collator.compare(a.name, b.name));
  const homeless = S.games.filter(g => !g.placeId || !place(g.placeId));
  const lent = S.games.filter(g => g.lentTo);

  if (!rooms.length) {
    return header('Квартира', '') + `<div class="empty">
      <div class="empty-ico">🏠</div>
      <div class="empty-title">Комнат пока нет</div>
      <div class="empty-text">Создай комнату, внутри неё — мебель, а в мебели — конкретную полку. Игры можно класть на любом уровне.</div>
      <button class="btn" data-act="add-room">＋ Добавить комнату</button>
    </div>`;
  }

  const roomRows = rooms.map(r => {
    const n = gamesIn(r.id).length;
    const kids = childrenOf(r.id).length;
    return `<a class="row" href="#/place/${r.id}">
      <span class="row-ico">${esc(r.icon)}</span>
      <span class="row-main">
        <span class="row-title">${esc(r.name)}</span>
        <span class="row-sub">${kids ? `${kids} ${plural(kids, 'предмет', 'предмета', 'предметов')} мебели · ` : ''}${n} ${plural(n, 'игра', 'игры', 'игр')}</span>
      </span>
      <span class="row-chev">›</span>
    </a>`;
  }).join('');

  return header('Квартира', `${S.games.length} ${plural(S.games.length, 'игра', 'игры', 'игр')} по ${rooms.length} ${plural(rooms.length, 'комнате', 'комнатам', 'комнатам')}`) + `
    <div class="list">${roomRows}</div>
    <div class="pad" style="margin-top:12px">
      <button class="btn ghost sm" data-act="add-room">＋ Добавить комнату</button>
    </div>
    ${lent.length ? `
      <div class="sect-title">Одолжены</div>
      <div class="list">${lent.map(g => gameRow(g, `🤝 у ${g.lentTo}`)).join('')}</div>` : ''}
    ${homeless.length ? `
      <div class="sect-title">Без места</div>
      <div class="list">${homeless.filter(g => !g.lentTo).map(g => gameRow(g, 'нажми, чтобы указать место')).join('')}</div>` : ''}
  `;
}

function gameRow(g, sub) {
  const art = g.photoUrl
    ? `<img class="row-thumb" src="${esc(thumb(g.photoUrl, 200))}" alt="" loading="lazy">`
    : `<span class="row-ico" style="width:42px;height:42px;font-size:20px">🎲</span>`;
  return `<button class="row" data-game="${g.id}">
    ${art}
    <span class="row-main">
      <span class="row-title">${esc(g.title)}</span>
      <span class="row-sub">${esc(sub ?? whereStr(g))}</span>
    </span>
    <span class="row-chev">›</span>
  </button>`;
}

/* ---------- Экран места ---------- */
function viewPlace(id) {
  const p = place(id);
  if (!p) { go('#/home'); return ''; }

  const kids = childrenOf(id);
  const here = S.games.filter(g => g.placeId === id);
  const deep = gamesIn(id).length;
  const meta = KINDS[p.kind];
  const parent = p.parentId ? place(p.parentId) : null;
  const backHref = parent ? `#/place/${parent.id}` : '#/home';

  const kidRows = kids.map(k => {
    const n = gamesIn(k.id).length;
    const kk = childrenOf(k.id).length;
    return `<a class="row" href="#/place/${k.id}">
      <span class="row-ico">${esc(k.icon)}</span>
      <span class="row-main">
        <span class="row-title">${esc(k.name)}</span>
        <span class="row-sub">${kk ? `${kk} ${plural(kk, 'место', 'места', 'мест')} · ` : ''}${n} ${plural(n, 'игра', 'игры', 'игр')}</span>
      </span>
      <span class="row-chev">›</span>
    </a>`;
  }).join('');

  return header(
    `${p.icon} ${p.name}`,
    `${meta.label}${parent ? ' · ' + pathStr(parent.id) : ''} · ${deep} ${plural(deep, 'игра', 'игры', 'игр')}`,
    backHref, parent ? parent.name : 'Квартира'
  ) + `
    ${kids.length ? `<div class="sect-title">${p.kind === 'room' ? 'Мебель' : 'Места'}</div><div class="list">${kidRows}</div>` : ''}

    ${meta.childKind ? `<div class="pad" style="margin-top:12px">
      <button class="btn ghost sm" data-act="add-child" data-parent="${p.id}" data-kind="${meta.childKind}">
        ＋ Добавить ${esc(meta.childLabel)}
      </button>
    </div>` : ''}

    <div class="sect-title">Лежат здесь${here.length ? ` · ${here.length}` : ''}</div>
    ${here.length ? gridHtml(here, false) : `
      <div class="pad"><div class="hint" style="margin:0 0 4px">Прямо на этом уровне игр нет${kids.length ? ' — загляни внутрь' : ''}.</div></div>`}

    <div class="pad" style="margin-top:12px">
      <button class="btn ghost sm" data-act="place-games" data-id="${p.id}">📦 Отметить, что лежит здесь</button>
    </div>

    <div class="pad" style="margin-top:20px;display:flex;flex-direction:column;gap:9px">
      <button class="btn ghost sm" data-act="edit-place" data-id="${p.id}">✏️ Переименовать</button>
      <button class="btn ghost sm" data-act="del-place" data-id="${p.id}" style="color:var(--danger)">🗑 Удалить ${esc(meta.label.toLowerCase())}</button>
    </div>
  `;
}

/* ============================================================
   Что сыграть — тест из трёх вопросов

   Логика та же, что на схеме GaGa: сколько вас → простое или нет →
   что хотите устроить. На каждом варианте показываем, сколько игр за ним
   стоит: тупиков вида «под эти условия ничего нет» быть не должно.
   ============================================================ */
const quiz = { step: 0, players: null, simple: null, vibe: null, tags: new Set() };

const PLAYER_BUCKETS = [
  { v: '1',   label: 'Один',    sub: 'Соло-режим' },
  { v: '2',   label: 'Вдвоём',  sub: '' },
  { v: '3-4', label: 'Трое-четверо', sub: '' },
  { v: '5+',  label: 'Пятеро и больше', sub: '' },
];

function playersFit(g, bucket) {
  const lo = g.playersMin || 1;
  const hi = g.playersMax || lo;
  if (bucket === '5+') return hi >= 5;
  if (bucket === '3-4') return lo <= 4 && hi >= 3;
  const n = +bucket;
  return lo <= n && hi >= n;
}

function quizMatches(over = {}) {
  const a = { ...quiz, ...over };
  let list = S.games.filter(g => !g.lentTo);
  if (a.players) list = list.filter(g => playersFit(g, a.players));
  if (a.simple === 'easy') list = list.filter(g => complexityOf(g) === 0);
  if (a.simple === 'hard') list = list.filter(g => complexityOf(g) >= 1);
  if (a.vibe && a.vibe !== 'any') list = list.filter(g => vibesOf(g).includes(a.vibe));
  if (a.tags && a.tags.size) list = list.filter(g => [...a.tags].every(t => (g.tags || []).includes(t)));
  return list.sort((x, y) => (y.rating || 0) - (x.rating || 0));
}

const qopt = (q, v, icon, title, sub, n, big) => `
  <button class="qopt${big ? ' big' : ''}" data-q="${q}" data-v="${esc(v)}" ${n === 0 ? 'disabled' : ''}>
    ${icon ? `<span class="qopt-ico">${icon}</span>` : ''}
    <span class="qopt-main">
      <span class="qopt-t">${esc(title)}</span>
      ${sub ? `<span class="qopt-s">${esc(sub)}</span>` : ''}
    </span>
    <span class="qopt-n">${n}</span>
  </button>`;

function viewPick() {
  if (!S.games.length) {
    return header('Что сыграть', '') + `<div class="empty">
      <div class="empty-ico">🎯</div>
      <div class="empty-title">Сначала нужна коллекция</div>
      <div class="empty-text">Добавь игры — и здесь появится подбор под компанию и настроение.</div>
      <button class="btn" data-act="add-game">＋ Добавить игру</button>
    </div>`;
  }

  const dots = n => `<div class="qdots">${[0, 1, 2].map(i =>
    `<span class="qdot ${i === n ? 'on' : ''}"></span>`).join('')}</div>`;

  /* --- Шаг 1: сколько игроков --- */
  if (quiz.step === 0) {
    return header('Что сыграть', 'Три вопроса — и коробка на столе') + dots(0) + `
      <div class="qhead">Сколько вас будет?</div>
      <div class="pad">
        ${PLAYER_BUCKETS.map(b => qopt('players', b.v, '', b.label, b.sub,
            quizMatches({ players: b.v, simple: null, vibe: null }).length, true)).join('')}
      </div>`;
  }

  /* --- Шаг 2: простое или нет --- */
  if (quiz.step === 1) {
    const c = v => quizMatches({ simple: v, vibe: null }).length;
    return header('Что сыграть', '', null, null, '') + dots(1) + `
      <div class="qback"><button class="back-btn" data-q-back><span class="chev">‹</span>Назад</button></div>
      <div class="qhead">Что-нибудь простое?</div>
      <div class="pad">
        ${qopt('simple', 'easy', '🌤', 'Да, полегче', 'Правила объясняются за пять минут', c('easy'))}
        ${qopt('simple', 'hard', '🌩', 'Нет, можно посложнее', 'Готовы вникать', c('hard'))}
        ${qopt('simple', 'any', '🤷', 'Неважно', '', c('any'))}
      </div>`;
  }

  /* --- Шаг 3: что хотите устроить --- */
  if (quiz.step === 2) {
    const c = v => quizMatches({ vibe: v }).length;
    return header('Что сыграть', '', null, null, '') + dots(2) + `
      <div class="qback"><button class="back-btn" data-q-back><span class="chev">‹</span>Назад</button></div>
      <div class="qhead">Что хотите устроить?</div>
      <div class="pad">
        ${VIBES.map(v => qopt('vibe', v.id, v.icon, v.label, v.sub, c(v.id))).join('')}
        ${qopt('vibe', 'any', '🤷', 'Неважно', '', c('any'))}
      </div>`;
  }

  /* --- Результат --- */
  const list = quizMatches();
  const tags = allTags();
  const answers = [
    PLAYER_BUCKETS.find(b => b.v === quiz.players)?.label,
    quiz.simple === 'easy' ? 'попроще' : quiz.simple === 'hard' ? 'посложнее' : null,
    quiz.vibe && quiz.vibe !== 'any' ? vibe(quiz.vibe).label.toLowerCase() : null,
  ].filter(Boolean);

  return header('Что сыграть', answers.join(' · ') || 'Без условий', null, null,
    `<button class="hdr-btn" data-q-reset aria-label="Пройти заново" title="Пройти заново">↺</button>`) + `

    <div class="pad" style="margin-bottom:14px">
      <button class="btn" data-act="random" ${!list.length ? 'disabled' : ''}>🎲 Выбери за меня</button>
    </div>

    ${tags.length ? `<div class="chips scroll">
      ${tags.map(t => `<button class="chip ${quiz.tags.has(t) ? 'on' : ''}" data-ptag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>` : ''}

    <div class="sect-title">Подходит · ${list.length}</div>
    ${list.length ? gridHtml(list) : `
      <div class="empty">
        <div class="empty-ico">🤔</div>
        <div class="empty-title">Под эти условия ничего нет</div>
        <div class="empty-text">Сбрось теги или пройди тест заново с другими ответами.</div>
        <button class="btn ghost" data-q-reset>Пройти заново</button>
      </div>`}
  `;
}

/* ---------- Настройки ---------- */
function viewSettings() {
  const rooms = S.places.filter(p => p.kind === 'room').length;
  const furn  = S.places.filter(p => p.kind === 'furniture').length;
  const spots = S.places.filter(p => p.kind === 'spot').length;
  const noPlace = S.games.filter(g => !g.placeId || !place(g.placeId)).length;

  return header('Настройки', '') + `
    <div class="stat-row" style="margin-top:8px">
      <div class="stat"><div class="stat-v">${S.games.length}</div><div class="stat-l">игр</div></div>
      <div class="stat"><div class="stat-v">${rooms}</div><div class="stat-l">комнат</div></div>
      <div class="stat"><div class="stat-v">${furn + spots}</div><div class="stat-l">мест хранения</div></div>
    </div>
    ${noPlace ? `<div class="hint" style="color:var(--danger)">Без места лежит ${noPlace} ${plural(noPlace, 'игра', 'игры', 'игр')}.</div>` : ''}

    <div class="sect-title">Синхронизация</div>
    ${syncOn() ? `
      <div class="list">
        <button class="row" data-act="sync-now">
          <span class="row-ico">${canWrite() ? '🔄' : '👁'}</span>
          <span class="row-main">
            <span class="row-title">${canWrite() ? 'Синхронизировать сейчас' : 'Только чтение'}</span>
            <span class="row-sub" id="sync-status">…</span>
          </span><span class="row-chev">›</span>
        </button>
        <button class="row" data-act="sync-invite">
          <span class="row-ico">📲</span>
          <span class="row-main"><span class="row-title">Подключить ещё устройство</span>
          <span class="row-sub">Ссылка для телефона жены или второго телефона</span></span><span class="row-chev">›</span>
        </button>
        <button class="row danger" data-act="sync-off">
          <span class="row-ico">⛓️‍💥</span>
          <span class="row-main"><span class="row-title">Отключить это устройство</span>
          <span class="row-sub">Коллекция останется здесь, обмен прекратится</span></span>
        </button>
      </div>
      ${!canWrite() ? '<div class="hint" style="color:var(--danger)">Без токена правки с этого устройства никуда не уезжают.</div>' : ''}
    ` : `
      <div class="list">
        <button class="row" data-act="sync-setup">
          <span class="row-ico">☁️</span>
          <span class="row-main"><span class="row-title">Включить синхронизацию</span>
          <span class="row-sub">Одна коллекция на Маке и телефонах</span></span><span class="row-chev">›</span>
        </button>
      </div>
    `}

    <div class="sect-title">Пополнить коллекцию</div>
    <div class="list">
      <button class="row" data-act="bulk"><span class="row-ico">📥</span><span class="row-main"><span class="row-title">Добавить списком</span><span class="row-sub">Вставь названия — по одному в строке</span></span><span class="row-chev">›</span></button>
    </div>

    <div class="sect-title">Данные</div>
    <div class="list">
      <button class="row" data-act="export"><span class="row-ico">⬇️</span><span class="row-main"><span class="row-title">Сохранить копию</span><span class="row-sub">Файл JSON со всей коллекцией</span></span><span class="row-chev">›</span></button>
      <button class="row" data-act="copy"><span class="row-ico">📋</span><span class="row-main"><span class="row-title">Скопировать в буфер</span><span class="row-sub">Чтобы перенести на другое устройство</span></span><span class="row-chev">›</span></button>
      <button class="row" data-act="import"><span class="row-ico">⬆️</span><span class="row-main"><span class="row-title">Загрузить копию</span><span class="row-sub">Заменит текущие данные</span></span><span class="row-chev">›</span></button>
    </div>

    <div class="sect-title">Опасная зона</div>
    <div class="list">
      <button class="row danger" data-act="wipe"><span class="row-ico">🗑</span><span class="row-main"><span class="row-title">Стереть всё</span><span class="row-sub">Игры и места — без возврата</span></span></button>
    </div>

    <div class="hint" style="margin-top:22px">
      Данные хранятся только на этом устройстве, в браузере. Ничего никуда не отправляется.
      Информация об играх подтягивается с <b>tesera.ru</b>.
    </div>
    <div class="hint" style="margin-top:10px;opacity:.6">Полка · версия 1.0</div>
  `;
}

/* ============================================================
   ШТОРКА: карточка игры
   ============================================================ */
function openGame(id) {
  const g = game(id);
  if (!g) return;

  const cover = g.photoUrl
    ? `<img class="gd-cover" src="${esc(thumb(g.photoUrl, 400))}" alt="">`
    : `<div class="gd-cover gcard-ph" style="display:grid">🎲</div>`;

  openSheet(`
    <div class="sh-head float"><div class="sh-title"></div><button class="sh-close" data-sh-close>✕</button></div>
    ${g.photoUrl ? `<div class="gd-hero"><img src="${esc(thumb(g.photoUrl, 400))}" alt=""></div>` : '<div style="height:14px"></div>'}
    <div class="gd-top">
      ${cover}
      <h2 class="gd-title">${esc(g.title)}</h2>
      ${g.titleOrig ? `<div class="gd-orig">${esc(g.titleOrig)}${g.year ? ` · ${g.year}` : ''}</div>`
                    : g.year ? `<div class="gd-orig">${g.year}</div>` : ''}
    </div>

    <div class="facts">
      <div class="fact"><div class="fact-v">${esc(playersStr(g))}</div><div class="fact-l">игроков</div></div>
      <div class="fact"><div class="fact-v">${esc(timeStr(g))}</div><div class="fact-l">партия</div></div>
      <div class="fact"><div class="fact-v">${g.ageMin ? g.ageMin + '+' : '—'}</div><div class="fact-l">возраст</div></div>
      <div class="fact"><div class="fact-v">${g.rating ? g.rating.toFixed(1) : '—'}</div><div class="fact-l">рейтинг</div></div>
    </div>

    <button class="where-card" data-act="move-game" data-id="${g.id}">
      <span class="where-pin">${g.lentTo ? '🤝' : '📍'}</span>
      <span class="where-main">
        <span class="where-lbl">${g.lentTo ? 'Одолжена' : 'Где лежит'}</span>
        <div class="where-path">${esc(g.lentTo ? `у ${g.lentTo}` : (g.placeId && place(g.placeId) ? pathStr(g.placeId) : 'Место не указано'))}</div>
        ${g.note ? `<div class="where-note">${esc(g.note)}</div>` : ''}
      </span>
      <span class="row-chev">›</span>
    </button>

    <div class="sh-pad">
      <div class="field-lbl" style="margin-bottom:7px">
        Настроение ${vibeIsManual(g) ? '' : '<span style="text-transform:none;letter-spacing:0;font-weight:500">· определено само, можно поправить</span>'}
      </div>
      <div class="chips">
        ${VIBES.map(v => `<button class="chip ${vibesOf(g).includes(v.id) ? 'on' : ''}"
            data-vibe="${v.id}" data-gid="${g.id}">${v.icon} ${esc(v.label)}</button>`).join('')}
      </div>
      <div class="hint" style="margin:8px 0 0">
        Сложность: ${COMPLEXITY_LABEL[complexityOf(g)]}${g.timeToLearn ? ` · правила объяснять ≈${g.timeToLearn} мин` : ''}
      </div>
    </div>

    <div class="sh-pad" style="margin-top:16px">
      <div class="field-lbl" style="margin-bottom:7px">Теги</div>
      <div class="chips" id="gd-tags">
        ${(g.tags || []).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('') || '<span class="hint" style="margin:0">пока нет</span>'}
      </div>
    </div>

    <div class="sh-actions">
      <button class="btn ghost sm" data-act="edit-tags" data-id="${g.id}">🏷 Изменить теги</button>
      <button class="btn ghost sm" data-act="edit-note" data-id="${g.id}">📝 Заметка и «одолжена»</button>
      ${g.alias ? `<a class="btn ghost sm" href="https://tesera.ru/game/${esc(g.alias)}" target="_blank" rel="noopener">↗︎ Открыть на Tesera</a>` : ''}
      <button class="btn ghost sm" data-act="del-game" data-id="${g.id}" style="color:var(--danger)">🗑 Удалить из коллекции</button>
    </div>
  `);
}

/* ============================================================
   ШТОРКА: добавление игры
   ============================================================ */
let searchTimer = null;

function openAddGame() {
  openSheet(`
    ${sheetHead('Добавить игру')}
    <div class="field">
      <input type="text" id="ag-q" placeholder="Начни вводить название…"
             autocomplete="off" autocorrect="off" spellcheck="false" autofocus>
    </div>
    <div id="ag-res" class="sh-pad" style="min-height:120px">
      <div class="hint" style="margin:12px 0">Ищем по базе tesera.ru — можно по-русски или по-английски.</div>
    </div>
  `, body => {
    const q = $('#ag-q', body), res = $('#ag-res', body);
    setTimeout(() => q.focus(), 250);
    q.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const v = q.value.trim();
      if (v.length < 2) { res.innerHTML = '<div class="hint" style="margin:12px 0">Введи хотя бы два символа.</div>'; return; }
      res.innerHTML = '<div class="spin"></div>';
      searchTimer = setTimeout(async () => {
        try {
          const items = await teseraSearch(v);
          if (!items.length) {
            res.innerHTML = `<div class="hint" style="margin:12px 0">Ничего не нашлось.</div>
              <button class="btn ghost sm" data-manual="${esc(v)}">Добавить «${esc(v)}» вручную</button>`;
            return;
          }
          res.innerHTML = `<div class="list" style="margin:0">${items.map(it => `
            <button class="row" data-alias="${esc(it.alias)}">
              ${it.photoUrl ? `<img class="row-thumb" src="${esc(it.photoUrl)}" alt="" loading="lazy">`
                            : `<span class="row-ico" style="width:42px;height:42px">🎲</span>`}
              <span class="row-main">
                <span class="row-title">${esc(it.title || it.value)}</span>
                <span class="row-sub">${esc(it.title2 || '')}</span>
              </span>
              <span class="row-chev">＋</span>
            </button>`).join('')}</div>
            <button class="btn ghost sm" style="margin-top:12px" data-manual="${esc(v)}">Нет в списке — добавить вручную</button>`;
        } catch (err) {
          console.error(err);
          res.innerHTML = `<div class="hint" style="margin:12px 0;color:var(--danger)">Не получилось связаться с tesera.ru. Проверь интернет.</div>
            <button class="btn ghost sm" data-manual="${esc(v)}">Добавить «${esc(v)}» вручную</button>`;
        }
      }, 380);
    });

    res.addEventListener('click', async e => {
      const row = e.target.closest('[data-alias]');
      const man = e.target.closest('[data-manual]');
      if (row) {
        res.innerHTML = '<div class="spin"></div>';
        try {
          const t = await teseraGame(row.dataset.alias);
          openGameForm(fromTesera(t));
        } catch (err) {
          console.error(err);
          toast('Не удалось загрузить карточку');
        }
      } else if (man) {
        openGameForm({ ...fromTesera({}), title: man.dataset.manual });
      }
    });
  });
}

/* ---------- Форма новой игры ---------- */
function openGameForm(g) {
  const tagSuggest = [...new Set([...allTags(), ...PRESET_TAGS])];

  openSheet(`
    ${sheetHead('Новая игра')}
    <div style="text-align:center;padding:4px 0 14px">
      ${g.photoUrl ? `<img class="gd-cover" src="${esc(thumb(g.photoUrl, 400))}" alt="">` : `<div class="gd-cover gcard-ph" style="display:grid;margin:0 auto">🎲</div>`}
    </div>

    <div class="field">
      <div class="field-lbl">Название</div>
      <input type="text" id="f-title" value="${esc(g.title)}">
    </div>

    <div class="field">
      <div class="field-lbl">Где будет лежать</div>
      <button class="btn ghost sm" id="f-place" style="justify-content:space-between;padding:0 14px">
        <span id="f-place-txt">${g.placeId ? esc(pathStr(g.placeId)) : 'Выбрать место'}</span><span>›</span>
      </button>
    </div>

    <div class="field">
      <div class="field-lbl">Теги</div>
      <div class="chips" id="f-tags">
        ${tagSuggest.map(t => `<button class="chip" data-t="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <input type="text" id="f-newtag" placeholder="+ свой тег и Enter" style="margin-top:9px">
    </div>

    <div class="field">
      <div class="field-lbl">Заметка</div>
      <textarea id="f-note" placeholder="Например: в глубине, за коробкой с гирляндой">${esc(g.note || '')}</textarea>
    </div>

    <div class="sh-actions">
      <button class="btn" id="f-save">Добавить в коллекцию</button>
    </div>
  `, body => {
    const draft = { ...g, tags: [...(g.tags || [])] };

    const paint = () => $$('#f-tags .chip', body).forEach(c => c.classList.toggle('on', draft.tags.includes(c.dataset.t)));
    paint();

    $('#f-tags', body).addEventListener('click', e => {
      const c = e.target.closest('[data-t]'); if (!c) return;
      const t = c.dataset.t;
      const i = draft.tags.indexOf(t);
      if (i >= 0) draft.tags.splice(i, 1); else draft.tags.push(t);
      paint();
    });

    $('#f-newtag', body).addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const t = e.target.value.trim().toLowerCase();
      if (!t) return;
      if (!draft.tags.includes(t)) draft.tags.push(t);
      const box = $('#f-tags', body);
      if (!$$('[data-t]', box).some(c => c.dataset.t === t)) {
        box.insertAdjacentHTML('beforeend', `<button class="chip" data-t="${esc(t)}">${esc(t)}</button>`);
      }
      e.target.value = '';
      paint();
    });

    // Перед уходом в выбор места сохраняем всё, что уже введено руками.
    const capture = () => {
      draft.title = $('#f-title', body).value.trim() || draft.title;
      draft.note = $('#f-note', body).value.trim();
    };

    $('#f-place', body).addEventListener('click', () => {
      capture();
      openPlacePicker(pid => {
        draft.placeId = pid;
        openGameForm(draft);   // шторка перерисовывается на месте, без схлопывания
      });
    });

    $('#f-save', body).addEventListener('click', () => {
      capture();
      saveGame(draft);
      closeSheet();
      render();
      toast(`«${draft.title}» добавлена`);
    });
  });
}

/* ============================================================
   ШТОРКА: выбор места
   ============================================================ */
function openPlacePicker(onPick, currentId = null) {
  let cursor = null; // null = корень (список комнат)

  const draw = () => {
    const items = cursor === null
      ? S.places.filter(p => p.kind === 'room').sort((a, b) => collator.compare(a.name, b.name))
      : childrenOf(cursor);
    const cur = cursor ? place(cursor) : null;
    const meta = cur ? KINDS[cur.kind] : { childKind: 'room', childLabel: 'комнату' };

    openSheet(`
      ${sheetHead(cur ? `${cur.icon} ${cur.name}` : 'Куда положить', cursor !== null)}
      ${cur ? `<div class="hint" style="margin:-4px 16px 10px">${esc(pathStr(cur.id))}</div>` : ''}

      ${cur ? `<div class="sh-pad" style="margin-bottom:14px">
        <button class="btn" data-pick="${cur.id}">📍 Положить сюда</button>
      </div>` : ''}

      ${items.length ? `<div class="list">${items.map(p => {
        const n = gamesIn(p.id).length;
        return `<button class="row" data-into="${p.id}">
          <span class="row-ico">${esc(p.icon)}</span>
          <span class="row-main">
            <span class="row-title">${esc(p.name)}</span>
            <span class="row-sub">${n} ${plural(n, 'игра', 'игры', 'игр')}</span>
          </span>
          <span class="row-chev">›</span>
        </button>`;
      }).join('')}</div>` : `<div class="hint" style="margin:4px 16px 12px">Здесь пока ничего нет.</div>`}

      ${meta.childKind ? `<div class="sh-actions">
        <button class="btn ghost sm" data-new="${meta.childKind}" data-parent="${cur ? cur.id : ''}">
          ＋ Новая ${cursor === null ? 'комната' : (meta.childKind === 'furniture' ? 'мебель' : 'полка / место')}
        </button>
      </div>` : ''}

      ${cursor === null ? `<div class="sh-actions" style="padding-top:0">
        <button class="btn ghost sm" data-pick="">Пока без места</button>
      </div>` : ''}
    `, body => {
      body.onclick = async e => {
        const back = e.target.closest('[data-sh-back]');
        const into = e.target.closest('[data-into]');
        const pick = e.target.closest('[data-pick]');
        const nw   = e.target.closest('[data-new]');

        if (back) { const c = place(cursor); cursor = c && c.parentId ? c.parentId : null; draw(); }
        else if (into) { cursor = into.dataset.into; draw(); }
        else if (pick) { onPick(pick.dataset.pick || null); }
        else if (nw) {
          const kind = nw.dataset.new;
          const created = await promptPlace(kind, nw.dataset.parent || null);
          if (created) { cursor = created.id; draw(); }
        }
      };
    });
  };
  draw();
}

/* ============================================================
   ШТОРКА: отметить, что лежит на этой полке

   Обратный ход к «выбрать место для игры». Раскладывая коробки, человек
   стоит у полки и читает корешки, а не вспоминает по одной игре, где она.
   ============================================================ */
function openPlaceGames(placeId) {
  const p = place(placeId);
  if (!p) return;

  const chosen = new Set(S.games.filter(g => g.placeId === placeId).map(g => g.id));
  let q = '';

  // Сначала бесхозные — ради них всё и затевалось, потом здешние, потом чужие.
  const rank = g => g.placeId === placeId ? 1 : (!g.placeId || !place(g.placeId)) ? 0 : 2;

  const draw = () => {
    const needle = q.trim().toLowerCase();
    const list = S.games
      .filter(g => !needle || (g.title || '').toLowerCase().includes(needle)
                           || (g.titleOrig || '').toLowerCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || collator.compare(a.title, b.title));

    const homeless = S.games.filter(g => !g.placeId || !place(g.placeId)).length;

    openSheet(`
      ${sheetHead(`${p.icon} ${p.name}`)}
      <div class="hint" style="margin:-4px 16px 12px">
        Отметь коробки, которые здесь стоят.${homeless ? ` Без места сейчас ${homeless}.` : ''}
      </div>

      <div class="field">
        <input type="text" id="pg-q" placeholder="Поиск по названию" value="${esc(q)}"
               autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>

      ${list.length ? `<div class="list">${list.map(g => {
        const on = chosen.has(g.id);
        const where = g.placeId === placeId ? 'здесь'
                    : (!g.placeId || !place(g.placeId)) ? 'без места'
                    : pathStr(g.placeId);
        return `<button class="row" data-pg="${g.id}" style="${on ? '' : 'opacity:.55'}">
          ${g.photoUrl ? `<img class="row-thumb" src="${esc(thumb(g.photoUrl, 200))}" alt="" loading="lazy">`
                       : `<span class="row-ico" style="width:42px;height:42px">🎲</span>`}
          <span class="row-main">
            <span class="row-title">${esc(g.title)}</span>
            <span class="row-sub">${esc(where)}</span>
          </span>
          <span class="row-chev" style="${on ? 'color:var(--accent);opacity:1' : ''}">${on ? '✓' : '○'}</span>
        </button>`;
      }).join('')}</div>` : `<div class="hint" style="margin:4px 16px">Ничего не нашлось.</div>`}

      <div class="sh-actions">
        <button class="btn" data-pg-save>Готово · отмечено ${chosen.size}</button>
      </div>
    `, body => {
      const inp = $('#pg-q', body);
      inp.addEventListener('input', e => {
        q = e.target.value;
        const pos = e.target.selectionStart;
        draw();
        const again = $('#pg-q', sheetBody);
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      });

      body.onclick = e => {
        if (e.target.closest('[data-sh-close]')) { closeSheet(); return; }

        const row = e.target.closest('[data-pg]');
        if (row) {
          const id = row.dataset.pg;
          chosen.has(id) ? chosen.delete(id) : chosen.add(id);
          draw();
          return;
        }

        if (e.target.closest('[data-pg-save]')) {
          let moved = 0;
          S.games.forEach(g => {
            const shouldBeHere = chosen.has(g.id);
            const isHere = g.placeId === placeId;
            if (shouldBeHere === isHere) return;
            g.placeId = shouldBeHere ? placeId : null;
            saveGame(g);
            moved++;
          });
          closeSheet(); render();
          toast(moved ? `Разложено: ${moved}` : 'Ничего не изменилось');
        }
      };
    });
  };
  draw();
}

/* ---------- Создание / переименование места ---------- */
function promptPlace(kind, parentId, existing = null) {
  return new Promise(resolve => {
    const meta = KINDS[kind];
    const icons = ICONS[kind];
    let icon = existing ? existing.icon : icons[0];
    const titles = { room: 'Новая комната', furniture: 'Новая мебель', spot: 'Новое место' };
    const hints = {
      room: 'Гостиная, спальня, кабинет, кладовка…',
      furniture: 'Шкаф ИКЕА, стеллаж, комод, кровать…',
      spot: 'Нижняя полка, в глубине, верхний ящик, под кроватью…',
    };

    openSheet(`
      ${sheetHead(existing ? 'Переименовать' : titles[kind])}
      <div class="field">
        <div class="field-lbl">Название</div>
        <input type="text" id="np-name" placeholder="${esc(hints[kind])}" value="${esc(existing ? existing.name : '')}">
      </div>
      <div class="field">
        <div class="field-lbl">Значок</div>
        <div class="chips" id="np-icons">
          ${icons.map(i => `<button class="chip ${i === icon ? 'on' : ''}" data-i="${i}" style="font-size:17px;padding:6px 10px">${i}</button>`).join('')}
        </div>
      </div>
      <div class="sh-actions"><button class="btn" id="np-ok">${existing ? 'Сохранить' : 'Создать'}</button></div>
    `, body => {
      const inp = $('#np-name', body);
      setTimeout(() => inp.focus(), 250);

      $('#np-icons', body).addEventListener('click', e => {
        const c = e.target.closest('[data-i]'); if (!c) return;
        icon = c.dataset.i;
        $$('#np-icons .chip', body).forEach(x => x.classList.toggle('on', x.dataset.i === icon));
      });

      const submit = () => {
        const name = inp.value.trim();
        if (!name) { inp.focus(); return; }
        if (existing) {
          existing.name = name; existing.icon = icon; touch(existing); save();
          resolve(existing);
        } else {
          resolve(addPlace(parentId, kind, name, icon));
        }
      };
      $('#np-ok', body).addEventListener('click', submit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    });
  });
}

/* ---------- Редактирование тегов существующей игры ---------- */
function openEditTags(id) {
  const g = game(id); if (!g) return;
  const draft = [...(g.tags || [])];
  const all = [...new Set([...allTags(), ...PRESET_TAGS, ...draft])];

  openSheet(`
    ${sheetHead('Теги')}
    <div class="hint" style="margin:-4px 16px 12px">${esc(g.title)}</div>
    <div class="field">
      <div class="chips" id="et-tags">
        ${all.map(t => `<button class="chip ${draft.includes(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <input type="text" id="et-new" placeholder="+ свой тег и Enter" style="margin-top:10px">
    </div>
    <div class="sh-actions"><button class="btn" id="et-ok">Сохранить</button></div>
  `, body => {
    const box = $('#et-tags', body);
    box.addEventListener('click', e => {
      const c = e.target.closest('[data-t]'); if (!c) return;
      const t = c.dataset.t, i = draft.indexOf(t);
      if (i >= 0) draft.splice(i, 1); else draft.push(t);
      c.classList.toggle('on');
    });
    $('#et-new', body).addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const t = e.target.value.trim().toLowerCase(); if (!t) return;
      if (!draft.includes(t)) draft.push(t);
      if (!$$('[data-t]', box).some(c => c.dataset.t === t))
        box.insertAdjacentHTML('beforeend', `<button class="chip on" data-t="${esc(t)}">${esc(t)}</button>`);
      e.target.value = '';
    });
    $('#et-ok', body).addEventListener('click', () => {
      g.tags = draft; saveGame(g); closeSheet(); render(); toast('Теги обновлены');
    });
  });
}

/* ---------- Заметка + одолжена ---------- */
function openEditNote(id) {
  const g = game(id); if (!g) return;
  openSheet(`
    ${sheetHead('Заметка')}
    <div class="field">
      <div class="field-lbl">Уточнение к месту</div>
      <textarea id="en-note" placeholder="В глубине, за коробкой с гирляндой">${esc(g.note || '')}</textarea>
    </div>
    <div class="field">
      <div class="field-lbl">Одолжена (кому)</div>
      <input type="text" id="en-lent" value="${esc(g.lentTo || '')}" placeholder="Пусто — значит дома">
    </div>
    <div class="sh-actions"><button class="btn" id="en-ok">Сохранить</button></div>
  `, body => {
    $('#en-ok', body).addEventListener('click', () => {
      g.note = $('#en-note', body).value.trim();
      g.lentTo = $('#en-lent', body).value.trim();
      saveGame(g); closeSheet(); render(); toast('Сохранено');
    });
  });
}

/* ============================================================
   ШТОРКИ СИНХРОНИЗАЦИИ
   ============================================================ */
const DEFAULT_GIST = '43ad041b1c71cdc85b5f760e69d18b77';

function openSyncSetup() {
  openSheet(`
    ${sheetHead('Синхронизация')}

    <div class="field">
      <div class="field-lbl">Есть ссылка-приглашение?</div>
      <textarea id="sy-invite" placeholder="Вставь сюда ссылку с другого устройства"
                style="min-height:70px;font-size:13px" autocapitalize="off" spellcheck="false"></textarea>
      <button class="btn sm" id="sy-join" style="margin-top:9px">Подключиться по ссылке</button>
      <div class="hint" style="margin:8px 0 0">
        Так подключается второй телефон. На iOS приложение с домашнего экрана
        не видит того, что осталось в Safari, — код нужно перенести вставкой.
      </div>
    </div>

    <div class="sect-title" style="margin-left:16px">Или настроить вручную</div>

    <div class="hint" style="margin:0 16px 14px">
      Коллекция лежит в секретном gist на GitHub — бесплатно и без сервера.
      Читать его можно по номеру, а записывать — только с твоим токеном.
      Токен хранится на устройстве и никуда, кроме api.github.com, не уходит.
    </div>

    <div class="field">
      <div class="field-lbl">Номер хранилища</div>
      <input type="text" id="sy-gist" value="${esc(cfg.gistId || DEFAULT_GIST)}" autocapitalize="off" spellcheck="false">
    </div>

    ${cfg.token ? `<div class="hint" style="margin:0 16px 12px;color:var(--danger)">
      Сейчас сохранён токен из ${cfg.token.length} ${plural(cfg.token.length, 'символа', 'символов', 'символов')}${
        cfg.token.length !== 40 ? ' — у classic-токена GitHub их ровно 40, похоже он скопировался не целиком' : ''}.
      ${esc(checkToken(cfg.token) || '')}
    </div>` : ''}

    <div class="field">
      <div class="field-lbl">Токен GitHub</div>
      <input type="password" id="sy-token" placeholder="ghp_…" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="hint" style="margin:8px 0 0">
        Вставляй только копированием — вручную легко набрать русскую «с» вместо латинской.<br>
      </div>
      <div class="hint" style="margin:8px 0 0">
        Создать: <b>github.com → Settings → Developer settings → Personal access tokens →
        Tokens (classic) → Generate new token</b>. Отметь <b>только</b> галочку <code>gist</code> —
        больше ничего. Так токен не сможет ничего, кроме этой коллекции.
      </div>
    </div>

    <div class="sh-actions">
      <button class="btn" id="sy-ok">Подключить</button>
      <button class="btn ghost sm" id="sy-ro">Пока только читать</button>
    </div>
  `, body => {
    const finish = async withToken => {
      const gistId = cleanToken($('#sy-gist', body).value);
      const token = withToken ? cleanToken($('#sy-token', body).value) : '';
      if (!/^[0-9a-f]{16,}$/i.test(gistId)) { toast('Номер хранилища не похож на настоящий'); return; }
      if (withToken && !token) { toast('Вставь токен'); return; }
      const bad = checkToken(token);
      if (bad) { toast(bad); return; }

      cfg = { ...cfg, gistId, token };
      saveCfg();
      closeSheet();
      await syncNow();
      render();
    };
    $('#sy-ok', body).addEventListener('click', () => finish(true));
    $('#sy-ro', body).addEventListener('click', () => finish(false));

    $('#sy-join', body).addEventListener('click', async () => {
      const parsed = parseInvite($('#sy-invite', body).value);
      if (!parsed) { toast('Ссылка не разобралась — скопируй её целиком'); return; }
      cfg = { ...cfg, ...parsed };
      saveCfg();
      closeSheet();
      await syncNow();
      render();
    });
  });
}

function openInvite() {
  const link = inviteLink();
  openSheet(`
    ${sheetHead('Подключить устройство')}
    <div class="hint" style="margin:-4px 16px 14px">
      Открой эту ссылку на нужном телефоне — приложение само подхватит коллекцию,
      вводить ничего не придётся.
    </div>
    <div class="field">
      <div class="field-lbl">Ссылка-приглашение</div>
      <textarea id="iv-link" readonly style="min-height:92px;font-size:12px;word-break:break-all">${esc(link)}</textarea>
    </div>
    <div class="sh-actions">
      <button class="btn" id="iv-copy">Скопировать ссылку</button>
      ${navigator.share ? `<button class="btn ghost sm" id="iv-share">Отправить…</button>` : ''}
    </div>
    <div class="hint" style="margin-top:14px;color:var(--danger)">
      Внутри ссылки лежит твой токен. Обращайся с ней как с паролем: отправь жене
      в личку и не выкладывай никуда в общий доступ.
    </div>
  `, body => {
    $('#iv-copy', body).addEventListener('click', () => {
      navigator.clipboard.writeText(link)
        .then(() => toast('Ссылка скопирована'))
        .catch(() => { $('#iv-link', body).select(); toast('Скопируй выделенное'); });
    });
    const sh = $('#iv-share', body);
    if (sh) sh.addEventListener('click', () =>
      navigator.share({ title: 'Полка — наша коллекция настолок', url: link }).catch(() => {}));
  });
}

function openConnect(code) {
  const parsed = parseCode(code);
  history.replaceState(null, '', location.pathname + '#/collection');

  if (!parsed) {
    openSheet(`${sheetHead('Не получилось')}
      <div class="hint" style="margin:0 16px 16px">Ссылка испорчена — попроси прислать заново.</div>
      <div class="sh-actions"><button class="btn ghost" data-sh-close>Понятно</button></div>`);
    return;
  }

  const mine = S.games.length;
  openSheet(`
    ${sheetHead('Общая коллекция')}
    <div style="text-align:center;padding:6px 16px 18px">
      <div style="font-size:46px">🎲</div>
      <div style="font-size:19px;font-weight:750;margin-top:10px;letter-spacing:-.02em">Подключить это устройство?</div>
      <div class="hint" style="margin-top:8px">
        Коллекция станет общей: что добавишь здесь — появится на других устройствах, и наоборот.
        ${mine ? `<br><br>Игры, которые уже есть на этом устройстве (${mine}), не пропадут — они вольются в общую.` : ''}
      </div>
    </div>
    <div class="sh-actions">
      <button class="btn" id="cn-ok">Подключить</button>
      <button class="btn ghost sm" data-sh-close>Не сейчас</button>
    </div>
  `, body => {
    $('#cn-ok', body).addEventListener('click', async () => {
      cfg = { ...cfg, ...parsed };
      saveCfg();
      closeSheet();
      await syncNow();
      render();
      toast('Устройство подключено');
    });
  });
}

/* ============================================================
   ШТОРКА: добавление списком
   ============================================================ */
function openBulk() {
  openSheet(`
    ${sheetHead('Добавить списком')}
    <div class="hint" style="margin:-4px 16px 12px">
      По одному названию в строке. Каждое найдём на Tesera и подтянем обложку,
      число игроков и время. Потом разложишь их по местам.
    </div>
    <div class="field">
      <textarea id="bk-in" style="min-height:170px" placeholder="Каркассон&#10;Билет на поезд&#10;Кодовые имена&#10;盤 Ужас Аркхэма"></textarea>
    </div>
    <div class="sh-actions"><button class="btn" id="bk-go">Найти</button></div>
  `, body => {
    setTimeout(() => $('#bk-in', body).focus(), 250);
    $('#bk-go', body).addEventListener('click', () => {
      const names = $('#bk-in', body).value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!names.length) return;
      bulkResolve(names);
    });
  });
}

async function bulkResolve(names) {
  const found = [], missed = [];

  const paint = i => {
    openSheet(`
      ${sheetHead('Ищем…')}
      <div class="spin"></div>
      <div class="hint" style="text-align:center">${i} из ${names.length}</div>
    `);
  };
  paint(0);

  for (let i = 0; i < names.length; i++) {
    try {
      const hits = await teseraSearch(names[i]);
      if (!hits.length) { missed.push(names[i]); }
      else {
        const t = await teseraGame(bestHit(hits, names[i]).alias);
        const g = fromTesera(t);
        g.query = names[i];
        if (S.games.some(x => x.alias && x.alias === g.alias)) g.dup = true;
        found.push(g);
      }
    } catch (e) {
      console.warn('bulk', names[i], e);
      missed.push(names[i]);
    }
    paint(i + 1);
  }

  // По умолчанию отмечаем всё, кроме уже имеющегося в коллекции.
  const chosen = new Set(found.filter(g => !g.dup).map(g => g.id));
  let targetPlace = null;

  const draw = () => {
    const n = chosen.size;
    openSheet(`
      ${sheetHead('Что нашлось')}
      ${found.length ? `<div class="list">${found.map(g => `
        <button class="row" data-bulk="${g.id}" style="${chosen.has(g.id) ? '' : 'opacity:.42'}">
          ${g.photoUrl ? `<img class="row-thumb" src="${esc(thumb(g.photoUrl, 200))}" alt="">`
                       : `<span class="row-ico" style="width:42px;height:42px">🎲</span>`}
          <span class="row-main">
            <span class="row-title">${esc(g.title)}</span>
            <span class="row-sub">${g.dup ? '⚠️ уже есть в коллекции · ' : ''}по запросу «${esc(g.query)}»</span>
          </span>
          <span class="row-chev">${chosen.has(g.id) ? '✓' : '○'}</span>
        </button>`).join('')}</div>` : ''}

      ${missed.length ? `
        <div class="sect-title">Не нашлось · ${missed.length}</div>
        <div class="hint" style="margin-top:0">${missed.map(esc).join(', ')}. Их можно добавить вручную через «＋».</div>` : ''}

      <div class="field" style="margin-top:18px">
        <div class="field-lbl">Куда положить все отмеченные</div>
        <button class="btn ghost sm" data-bulk-place style="justify-content:space-between;padding:0 14px">
          <span>${targetPlace ? esc(pathStr(targetPlace)) : 'Пока без места'}</span><span>›</span>
        </button>
      </div>

      <div class="sh-actions">
        <button class="btn" data-bulk-save ${!n ? 'disabled' : ''}>Добавить ${n} ${plural(n, 'игру', 'игры', 'игр')}</button>
      </div>
    `, body => {
      body.onclick = e => {
        if (e.target.closest('[data-sh-close]')) { closeSheet(); return; }

        const row = e.target.closest('[data-bulk]');
        if (row) {
          const id = row.dataset.bulk;
          chosen.has(id) ? chosen.delete(id) : chosen.add(id);
          draw(); return;
        }
        if (e.target.closest('[data-bulk-place]')) {
          openPlacePicker(pid => { targetPlace = pid; draw(); });
          return;
        }
        if (e.target.closest('[data-bulk-save]')) {
          found.filter(g => chosen.has(g.id)).forEach(g => {
            const { query, dup, ...clean } = g;
            clean.placeId = targetPlace;
            saveGame(clean);
          });
          closeSheet(); render();
          toast(`Добавлено: ${chosen.size}`);
        }
      };
    });
  };
  draw();
}

/* ============================================================
   ЭКСПОРТ / ИМПОРТ
   ============================================================ */
function exportJSON() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `polka-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function importJSON() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!Array.isArray(d.games) || !Array.isArray(d.places)) throw new Error('bad shape');
        if (!confirm(`Заменить текущие данные на ${d.games.length} игр из файла?`)) return;
        S = { ...blank(), ...d };
        save(); render(); toast('Коллекция загружена');
      } catch (e) {
        console.error(e); toast('Файл не подошёл');
      }
    };
    rd.readAsText(f);
  };
  inp.click();
}

/* ---------- Демо-данные ---------- */
const DEMO_GAMES = ['каркассон', 'колонизаторы', 'билет на поезд', 'кодовые имена', 'диксит'];

async function seedDemo() {
  toast('Собираю пример…');
  const liv = addPlace(null, 'room', 'Гостиная', '🛋️');
  const shelf = addPlace(liv.id, 'furniture', 'Стеллаж ИКЕА', '📚');
  addPlace(shelf.id, 'spot', 'Верхняя полка', '🔝');
  const low = addPlace(shelf.id, 'spot', 'Нижняя полка, в глубине', '🕳️');
  const bed = addPlace(null, 'room', 'Спальня', '🛏️');
  const under = addPlace(bed.id, 'furniture', 'Под кроватью', '📦');

  const spots = [low.id, under.id, shelf.id, low.id, under.id];
  for (let i = 0; i < DEMO_GAMES.length; i++) {
    try {
      const hits = await teseraSearch(DEMO_GAMES[i]);
      if (!hits.length) continue;
      const t = await teseraGame(hits[0].alias);
      const g = fromTesera(t);
      g.placeId = spots[i];
      g.tags = i % 2 ? ['для компании'] : ['семейная'];
      saveGame(g);
    } catch (e) { console.warn('demo', e); }
  }
  render();
  toast('Готово — потыкай');
}

/* ============================================================
   ГЛОБАЛЬНЫЕ ОБРАБОТЧИКИ
   ============================================================ */
document.addEventListener('click', async e => {
  const t = e.target;

  // Открыть игру
  const gc = t.closest('[data-game]');
  if (gc) { openGame(gc.dataset.game); return; }

  // Фильтры коллекции
  const sortBtn = t.closest('[data-sort]');
  if (sortBtn) { cState.sort = sortBtn.dataset.sort; render(); return; }

  const tagBtn = t.closest('[data-tag]');
  if (tagBtn) {
    const tag = tagBtn.dataset.tag;
    cState.tags.has(tag) ? cState.tags.delete(tag) : cState.tags.add(tag);
    render(); return;
  }

  // Тест «что сыграть»
  const qa = t.closest('[data-q]');
  if (qa) { quiz[qa.dataset.q] = qa.dataset.v; quiz.step++; render(); return; }
  if (t.closest('[data-q-back]')) {
    quiz.step = Math.max(0, quiz.step - 1);
    quiz[['players', 'simple', 'vibe'][quiz.step]] = null;
    render(); return;
  }
  if (t.closest('[data-q-reset]')) {
    Object.assign(quiz, { step: 0, players: null, simple: null, vibe: null });
    quiz.tags.clear();
    render(); return;
  }
  const pt = t.closest('[data-ptag]');
  if (pt) {
    const tag = pt.dataset.ptag;
    quiz.tags.has(tag) ? quiz.tags.delete(tag) : quiz.tags.add(tag);
    render(); return;
  }

  // Настроение в карточке игры
  const vb = t.closest('[data-vibe]');
  if (vb) {
    const g = game(vb.dataset.gid); if (!g) return;
    const cur = new Set(vibesOf(g));
    const id = vb.dataset.vibe;
    cur.has(id) ? cur.delete(id) : cur.add(id);
    g.vibes = [...cur];
    saveGame(g); openGame(g.id); render(); return;
  }

  // Действия
  const act = t.closest('[data-act]');
  if (!act) return;

  switch (act.dataset.act) {
    case 'add-game': openAddGame(); break;

    case 'demo': seedDemo(); break;

    case 'add-room': {
      const p = await promptPlace('room', null);
      closeSheet();
      if (p) { render(); setTimeout(() => go(`#/place/${p.id}`), 80); }
      break;
    }

    case 'add-child': {
      const p = await promptPlace(act.dataset.kind, act.dataset.parent);
      closeSheet();
      if (p) render();
      break;
    }

    case 'edit-place': {
      const p = place(act.dataset.id); if (!p) break;
      await promptPlace(p.kind, p.parentId, p);
      closeSheet(); render();
      break;
    }

    case 'del-place': {
      const p = place(act.dataset.id); if (!p) break;
      const n = gamesIn(p.id).length;
      const kids = descendantIds(p.id).length - 1;
      const warn = [`Удалить «${p.name}»?`];
      if (kids) warn.push(`Вместе с ним удалится ${kids} ${plural(kids, 'вложенное место', 'вложенных места', 'вложенных мест')}.`);
      if (n) warn.push(`${n} ${plural(n, 'игра останется', 'игры останутся', 'игр останутся')} без места.`);
      if (!confirm(warn.join('\n'))) break;
      const back = p.parentId ? `#/place/${p.parentId}` : '#/home';
      removePlace(p.id);
      go(back);
      toast('Удалено');
      break;
    }

    case 'move-game': {
      const g = game(act.dataset.id); if (!g) break;
      openPlacePicker(pid => {
        g.placeId = pid; saveGame(g);
        closeSheet(); render();
        toast(pid ? `Теперь: ${pathStr(pid)}` : 'Место снято');
      }, g.placeId);
      break;
    }

    case 'place-games': openPlaceGames(act.dataset.id); break;
    case 'edit-tags': openEditTags(act.dataset.id); break;
    case 'edit-note': openEditNote(act.dataset.id); break;

    case 'del-game': {
      const g = game(act.dataset.id); if (!g) break;
      if (!confirm(`Удалить «${g.title}» из коллекции?`)) break;
      removeGame(g.id); closeSheet(); render(); toast('Удалено');
      break;
    }

    case 'random': {
      const list = quizMatches();
      if (!list.length) break;
      openGame(list[Math.floor(Math.random() * list.length)].id);
      break;
    }

    // Кубик в шапке коллекции: тянет из того, что сейчас на экране,
    // так что фильтр по тегу или поиск сужают жеребьёвку.
    case 'random-any': {
      const list = collectionList().filter(g => !g.lentTo);
      if (!list.length) { toast('Нечего выбирать'); break; }
      openGame(list[Math.floor(Math.random() * list.length)].id);
      break;
    }

    case 'sync-setup': openSyncSetup(); break;
    case 'sync-invite': openInvite(); break;
    case 'sync-now': syncNow(); break;

    case 'sync-off':
      if (!confirm('Отключить это устройство от общей коллекции?\nИгры останутся здесь, но обмен прекратится.')) break;
      cfg = {}; saveCfg(); render(); toast('Отключено');
      break;

    case 'bulk': openBulk(); break;
    case 'export': exportJSON(); break;
    case 'import': importJSON(); break;

    case 'copy':
      navigator.clipboard.writeText(JSON.stringify(S))
        .then(() => toast('Скопировано в буфер'))
        .catch(() => toast('Буфер недоступен'));
      break;

    case 'wipe': {
      const warn = syncOn()
        ? 'Стереть всю коллекцию и все места?\nУстройства подключены к общей коллекции — сотрётся и у них тоже.\nОтменить будет нельзя.'
        : 'Стереть всю коллекцию и все места? Отменить будет нельзя.';
      if (!confirm(warn)) break;
      // Надгробия оставляем, иначе стёртое приедет обратно с другого устройства.
      const graves = { ...(S.trash || {}) };
      [...S.games, ...S.places].forEach(x => { graves[x.id] = now(); });
      S = { ...blank(), trash: graves };
      save(); go('#/collection'); render(); toast('Пусто');
      break;
    }
  }
});

// Поиск в коллекции
view.addEventListener('input', e => {
  if (e.target.id !== 'c-q') return;
  cState.q = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const inp = $('#c-q', view);
  if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
});

$('#tb-add').addEventListener('click', openAddGame);
$('#sb-add').addEventListener('click', openAddGame);

/* ---------- Старт ---------- */
if (!location.hash) location.hash = '#/collection';
render();

// Подтягиваем чужие правки при запуске, при возврате к вкладке
// и когда связь вернулась.
if (syncOn()) {
  setTimeout(() => syncNow({ silent: true }), 400);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && now() - (cfg.lastSync || 0) > 20000) syncNow({ silent: true });
  });
  window.addEventListener('online', () => syncNow({ silent: true }));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.log('SW:', e.message));
  });
}
