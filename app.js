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
  requestAnimationFrame(() => t.classList.add('in'));
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
  return { v: 1, places: [], games: [], seenIntro: false };
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
  const p = { id: uid(), parentId: parentId || null, kind, name: name.trim(), icon: icon || KINDS[kind].icon };
  S.places.push(p); save();
  return p;
}

function removePlace(id) {
  const ids = new Set(descendantIds(id));
  S.games.forEach(g => { if (ids.has(g.placeId)) g.placeId = null; });
  S.places = S.places.filter(p => !ids.has(p.id));
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
  const i = S.games.findIndex(x => x.id === g.id);
  if (i >= 0) S.games[i] = g; else S.games.push(g);
  save();
}

function removeGame(id) {
  S.games = S.games.filter(g => g.id !== id);
  save();
}

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
    playersRec: t.playersMaxRecommend || null,
    ageMin: t.playersAgeMin || null,
    playtimeMin: t.playtimeMin || null,
    playtimeMax: t.playtimeMax || null,
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
  if (!layer.classList.contains('in')) requestAnimationFrame(() => layer.classList.add('in'));
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

  $$('[data-tab]').forEach(el => el.classList.toggle('on',
    el.dataset.tab === route || (route === 'place' && el.dataset.tab === 'home')));

  $('#sb-count-games').textContent = S.games.length || '';
  $('#sb-count-places').textContent = S.places.filter(p => p.kind === 'room').length || '';

  const views = { collection: viewCollection, home: viewHome, place: viewPlace, pick: viewPick, settings: viewSettings };
  const fn = views[route] || viewCollection;
  view.innerHTML = fn(arg);
  main.scrollTop = scrollMem[raw] || 0;
  updateStuck();
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

function viewCollection() {
  const tags = allTags();
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
  list.sort(sorters[cState.sort]);

  if (!S.games.length) return header('Коллекция', '') + emptyStart();

  return header('Коллекция', `${S.games.length} ${plural(S.games.length, 'игра', 'игры', 'игр')}`) + `
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

function header(title, sub, backHref, backLabel) {
  return `<div class="hdr">
    ${backHref ? `<a class="back-btn" href="${backHref}"><span class="chev">‹</span>${esc(backLabel || 'Назад')}</a>` : ''}
    <div class="hdr-row"><h1 class="hdr-title">${esc(title)}</h1></div>
    ${sub ? `<div class="hdr-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

function emptyStart() {
  return `<div class="empty">
    <div class="empty-ico">🎲</div>
    <div class="empty-title">Пока пусто</div>
    <div class="empty-text">Добавь первую игру — название подтянется с Tesera вместе с обложкой, числом игроков и временем партии.</div>
    <button class="btn" data-act="add-game">＋ Добавить игру</button>
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

    <div class="pad" style="margin-top:20px;display:flex;flex-direction:column;gap:9px">
      <button class="btn ghost sm" data-act="edit-place" data-id="${p.id}">✏️ Переименовать</button>
      <button class="btn ghost sm" data-act="del-place" data-id="${p.id}" style="color:var(--danger)">🗑 Удалить ${esc(meta.label.toLowerCase())}</button>
    </div>
  `;
}

/* ---------- Что сыграть ---------- */
const pState = { players: 0, time: 0, tags: new Set() };

function pickMatches() {
  let list = S.games.filter(g => !g.lentTo);
  if (pState.players) {
    const n = pState.players;
    list = list.filter(g => {
      if (!g.playersMin && !g.playersMax) return false;
      const lo = g.playersMin || 1, hi = g.playersMax || lo;
      return n >= lo && (n <= hi || (n === 6 && hi >= 6));
    });
  }
  if (pState.time) {
    const lim = pState.time;
    list = list.filter(g => {
      const t = g.playtimeMax || g.playtimeMin;
      if (!t) return false;
      return lim === 999 ? t > 120 : t <= lim;
    });
  }
  if (pState.tags.size) list = list.filter(g => [...pState.tags].every(t => (g.tags || []).includes(t)));
  return list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

function viewPick() {
  const tags = allTags();
  const list = pickMatches();
  const P = [1, 2, 3, 4, 5, 6];
  const T = [[30, 'до 30′'], [60, 'до часа'], [120, 'до 2 ч'], [999, 'дольше']];

  return header('Что сыграть', 'Подбор по составу и времени') + `
    <div class="sect-title">Сколько игроков</div>
    <div class="chips scroll">
      <button class="chip ${!pState.players ? 'on' : ''}" data-pl="0">Неважно</button>
      ${P.map(n => `<button class="chip ${pState.players === n ? 'on' : ''}" data-pl="${n}">${n}${n === 6 ? '+' : ''}</button>`).join('')}
    </div>

    <div class="sect-title">Сколько времени</div>
    <div class="chips scroll">
      <button class="chip ${!pState.time ? 'on' : ''}" data-tm="0">Неважно</button>
      ${T.map(([v, l]) => `<button class="chip ${pState.time === v ? 'on' : ''}" data-tm="${v}">${l}</button>`).join('')}
    </div>

    ${tags.length ? `
      <div class="sect-title">Настроение</div>
      <div class="chips scroll">
        ${tags.map(t => `<button class="chip ${pState.tags.has(t) ? 'on' : ''}" data-ptag="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>` : ''}

    <div class="pad" style="margin:16px 16px 4px">
      <button class="btn" data-act="random" ${!list.length ? 'disabled' : ''}>🎲 Выбери за меня</button>
    </div>

    <div class="sect-title">Подходит · ${list.length}</div>
    ${list.length ? gridHtml(list) : `
      <div class="empty">
        <div class="empty-ico">🤔</div>
        <div class="empty-title">Под эти условия ничего нет</div>
        <div class="empty-text">Ослабь фильтры — или у части игр просто не заполнены игроки и время.</div>
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
          existing.name = name; existing.icon = icon; save();
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
      g.tags = draft; save(); closeSheet(); render(); toast('Теги обновлены');
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
      save(); closeSheet(); render(); toast('Сохранено');
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

  // Фильтры подбора
  const pl = t.closest('[data-pl]');
  if (pl) { pState.players = +pl.dataset.pl; render(); return; }
  const tm = t.closest('[data-tm]');
  if (tm) { pState.time = +tm.dataset.tm; render(); return; }
  const pt = t.closest('[data-ptag]');
  if (pt) {
    const tag = pt.dataset.ptag;
    pState.tags.has(tag) ? pState.tags.delete(tag) : pState.tags.add(tag);
    render(); return;
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
        g.placeId = pid; save();
        closeSheet(); render();
        toast(pid ? `Теперь: ${pathStr(pid)}` : 'Место снято');
      }, g.placeId);
      break;
    }

    case 'edit-tags': openEditTags(act.dataset.id); break;
    case 'edit-note': openEditNote(act.dataset.id); break;

    case 'del-game': {
      const g = game(act.dataset.id); if (!g) break;
      if (!confirm(`Удалить «${g.title}» из коллекции?`)) break;
      removeGame(g.id); closeSheet(); render(); toast('Удалено');
      break;
    }

    case 'random': {
      const list = pickMatches();
      if (!list.length) break;
      const g = list[Math.floor(Math.random() * list.length)];
      openGame(g.id);
      break;
    }

    case 'bulk': openBulk(); break;
    case 'export': exportJSON(); break;
    case 'import': importJSON(); break;

    case 'copy':
      navigator.clipboard.writeText(JSON.stringify(S))
        .then(() => toast('Скопировано в буфер'))
        .catch(() => toast('Буфер недоступен'));
      break;

    case 'wipe':
      if (!confirm('Стереть всю коллекцию и все места? Отменить будет нельзя.')) break;
      S = blank(); save(); go('#/collection'); render(); toast('Пусто');
      break;
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.log('SW:', e.message));
  });
}
