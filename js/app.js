import { db } from './db.js';
import { getPosition, reverseGeocode } from './location.js';
import { readExif } from './exif.js';
import { fetchWeather, weatherInfo } from './weather.js';
import {
  $, esc, uid, dayKey, parseDay, addDays, isDayKey, weekday, fmtTime, fmtDate, fmtRelative,
  linkify, toast, resizeImage, blobToDataURL, dataURLToBlob, loadMapLibre, squareImageDataURL,
} from './util.js';

/* ================= 設定 ================= */
const SETTINGS_KEY = 'daylog.settings';
const DEFAULTS = { name: 'わたし', handle: 'me', avatarImage: '', autoLocation: true, geocode: true, weather: true };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}
let settings = loadSettings();
// アイコン：設定した画像。未設定なら人型のマーク
const PERSON_ICON = '<svg class="person" viewBox="0 0 24 24"><circle cx="12" cy="9" r="4"/><path d="M4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/></svg>';
const avatarHTML = () => (settings.avatarImage ? `<img src="${settings.avatarImage}" alt="">` : PERSON_ICON);

/* ================= 地図 ================= */
// OpenFreeMap のベクター地図（APIキー不要・高解像度画面でもくっきり）
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// 地図を作り、ピンを置いて、全ピンが入るように表示する
async function createMap(el, located, { makePin, popupHTML, maxZoom = 15, onLoad }) {
  const ml = await loadMapLibre();
  if (!el.isConnected) return;
  const coords = located.map((p) => [p.loc.lng, p.loc.lat]);
  const map = new ml.Map({
    container: el,
    style: MAP_STYLE,
    center: coords[0],
    zoom: maxZoom,
    attributionControl: { compact: true },
    cooperativeGestures: false,
  });
  maps.push(map);
  located.forEach((p, i) => {
    new ml.Marker({ element: makePin(p, i), anchor: 'bottom' })
      .setLngLat(coords[i])
      .setPopup(new ml.Popup({ offset: 30, closeButton: false }).setHTML(popupHTML(p)))
      .addTo(map);
  });
  if (coords.length > 1) {
    const bounds = coords.reduce((b, c) => b.extend(c), new ml.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: 50, maxZoom, duration: 0 });
  }
  map.on('load', () => {
    // 地名を日本語表記に
    for (const layer of map.getStyle().layers) {
      // 3Dビルを消してすっきり見せる
      if (layer.type === 'fill-extrusion') { map.setLayoutProperty(layer.id, 'visibility', 'none'); continue; }
      if (layer.type !== 'symbol') continue;
      const tf = map.getLayoutProperty(layer.id, 'text-field');
      // 道路番号の看板を消す
      if (tf && JSON.stringify(tf).includes('"ref"')) { map.setLayoutProperty(layer.id, 'visibility', 'none'); continue; }
      if (tf && JSON.stringify(tf).includes('name')) {
        map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ja'], ['get', 'name']]);
      }
    }
    onLoad?.(map, coords);
  });
}

function pinEl(cls, html) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return el;
}

/* ================= アイコン ================= */
const I = {
  photo: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3zM9 7h6M9 11h6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  reply: '<svg viewBox="0 0 24 24"><path d="M4 12a8 7 0 0 1 8-7h0a8 7 0 0 1 0 14H9l-5 3 1.5-4.5A6.8 6.8 0 0 1 4 12z"/></svg>',
  quote: '<svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3M17 17H6l3 3M18 7v5M6 17v-5"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
};

/* ================= 今日の気分 ================= */
const MOODS = [
  { v: 5, e: '😆', label: '最高' },
  { v: 4, e: '😊', label: 'いい' },
  { v: 3, e: '🙂', label: 'ふつう' },
  { v: 2, e: '😔', label: 'いまいち' },
  { v: 1, e: '😢', label: 'つらい' },
];
const moodOf = (v) => MOODS.find((m) => m.v === v) || null;

function moodButtonsHTML(current) {
  return MOODS.map((m) => `<button type="button" class="mood-btn ${current === m.v ? 'sel' : ''}" data-mood="${m.v}" aria-label="${m.label}">
    <span class="e">${m.e}</span><span class="l">${m.label}</span></button>`).join('');
}

// 気分ボタンの動作。同じ気分をもう一度押すと取り消し
function bindMoodButtons(root, date, onChange) {
  root.querySelectorAll('[data-mood]').forEach((b) => b.addEventListener('click', async () => {
    const rec = (await db.getDay(date)) || { date };
    const v = Number(b.dataset.mood);
    rec.mood = rec.mood === v ? null : v;
    rec.updatedAt = Date.now();
    await db.putDay(rec);
    root.querySelectorAll('[data-mood]').forEach((x) => x.classList.toggle('sel', Number(x.dataset.mood) === rec.mood));
    onChange?.(rec.mood);
  }));
}

/* ================= 移動距離 ================= */
// 2点間の距離（km）
function haversine(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// 足あとを時間順につないだ距離。日をまたぐ移動は数えない（日ごとに合計）
function trailKm(posts) {
  const byDay = new Map();
  for (const p of posts) {
    if (!p.loc) continue;
    if (!byDay.has(p.day)) byDay.set(p.day, []);
    byDay.get(p.day).push(p);
  }
  let km = 0;
  for (const list of byDay.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 1; i < list.length; i++) km += haversine(list[i - 1].loc, list[i].loc);
  }
  return km;
}
const fmtKm = (km) => (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString());

/* ================= 連続記録 ================= */
function streakOf(posts) {
  const days = new Set(posts.map((p) => p.day));
  const today = dayKey();
  let cur = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) cur++;
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...days].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current: cur, best, todayDone: days.has(today) };
}

/* ================= 描画まわり ================= */
const view = $('#view');
const titleEl = $('#title');
const extraEl = $('#topbar-extra');
let objectURLs = [];
let maps = [];
let renderSeq = 0;

function blobURL(blob) {
  const u = URL.createObjectURL(blob);
  objectURLs.push(u);
  return u;
}
// 写真は画面に近づいたものだけ読み込む
let photoObserver = null;
function hydratePhotos(root = view) {
  if (!photoObserver) {
    photoObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const img = en.target;
        photoObserver.unobserve(img);
        db.getPhoto(img.dataset.photo).then((blob) => {
          if (blob && img.isConnected) img.src = blobURL(blob);
        });
      }
    }, { rootMargin: '600px 0px' });
  }
  root.querySelectorAll('img[data-photo]:not([src])').forEach((img) => photoObserver.observe(img));
}

function cleanup() {
  photoObserver?.disconnect();
  photoObserver = null;
  objectURLs.forEach((u) => URL.revokeObjectURL(u));
  objectURLs = [];
  maps.forEach((m) => m.remove());
  maps = [];
}

function setChrome(title, tab, extra = '') {
  titleEl.textContent = title;
  extraEl.innerHTML = extra;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
}

async function router() {
  const seq = ++renderSeq;
  const alive = () => seq === renderSeq;
  const [name = '', arg = ''] = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  cleanup();
  try {
    switch (name) {
      case 'day': await renderDay(isDayKey(arg) ? arg : dayKey(), alive); break;
      case 'calendar': await renderCalendar(arg, alive); break;
      case 'map': await renderMap(arg, alive); break;
      case 'settings': await renderSettings(alive); break;
      case 'search': await renderHome('#' + decodeURIComponent(arg), alive); break;
      default: await renderHome('', alive);
    }
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><strong>エラー</strong>${esc(e.message)}</div>`;
  }
}

/* ================= ポスト ================= */
// 引用・返信を表示するための索引（各画面で全ポストを読み込んだときに更新）
let postIndex = new Map();
let replyIndex = new Map(); // 元ポストID → 返信の配列（古い順）
function indexPosts(all) {
  postIndex = new Map(all.map((p) => [p.id, p]));
  replyIndex = new Map();
  for (const p of all) {
    if (!p.replyTo || !postIndex.has(p.replyTo)) continue;
    if (!replyIndex.has(p.replyTo)) replyIndex.set(p.replyTo, []);
    replyIndex.get(p.replyTo).push(p);
  }
  for (const list of replyIndex.values()) list.sort((a, b) => a.createdAt - b.createdAt);
}
const isRoot = (p) => !p.replyTo || !postIndex.has(p.replyTo);
const snippet = (t, n = 80) => { const s1 = (t || '').replace(/\s+/g, ' ').trim(); return s1.length > n ? `${s1.slice(0, n)}…` : s1; };

function quoteHTML(p) {
  if (!p.quoteOf) return '';
  const q = postIndex.get(p.quoteOf);
  if (!q) return '<div class="quote gone">この投稿は削除されました</div>';
  const body = q.text ? esc(snippet(q.text, 140)) : (q.photos?.length ? '📷 写真' : (q.kind === 'checkin' ? '📍 チェックイン' : ''));
  return `<a class="quote" href="#/day/${q.day}">
    <div class="q-head"><span class="avatar mini">${avatarHTML()}</span><b>${esc(settings.name)}</b><span>· ${fmtDate(q.createdAt)}</span></div>
    <div class="q-text">${body}${q.loc?.name ? `<span class="q-loc">📍${esc(q.loc.name)}</span>` : ''}</div></a>`;
}

// スレッド：元のポスト＋自分への返信をつなげて表示
function threadHTML(root, opts = {}) {
  const replies = replyIndex.get(root.id) || [];
  if (!replies.length) return postHTML(root, opts);
  return `<div class="thread">${postHTML(root, opts)}${replies.map((r) => postHTML(r, { ...opts, inThread: true })).join('')}</div>`;
}

function postHTML(p, { diary = false, pageDay = null, inThread = false, context = false } = {}) {
  const photos = p.photos || [];
  const media = photos.length
    ? `<div class="media n${Math.min(photos.length, 4)}">${photos.slice(0, 4)
      .map((id) => `<img data-photo="${esc(id)}" alt="" data-action="zoom">`).join('')}</div>`
    : '';
  const locName = p.loc ? (p.loc.name || `${p.loc.lat.toFixed(4)}, ${p.loc.lng.toFixed(4)}`) : '';
  const loc = p.loc
    ? `<a class="loc-chip" data-loc-for="${p.id}" href="#/day/${p.day}">${I.pin}<span>${esc(locName)}</span></a>`
    : '';
  const text = p.text
    ? `<div class="post-text">${linkify(p.text)}</div>`
    : (p.kind === 'checkin' ? '<div class="post-text">チェックインしました</div>' : '');
  const time = diary && (!pageDay || p.day === pageDay)
    ? `<span class="time">${fmtTime(p.createdAt)}</span>`
    : diary
      ? `<a class="time" href="#/day/${p.day}">${fmtDate(p.createdAt)} ${fmtTime(p.createdAt)}</a>`
      : `<a class="time" href="#/day/${p.day}">${fmtRelative(p.createdAt)}</a>`;
  // スレッドの外で返信を表示するときは、何への返信かを出す
  const parent = p.replyTo ? postIndex.get(p.replyTo) : null;
  const ctx = context && parent
    ? `<a class="reply-ctx" href="#/day/${parent.day}">↪ ${fmtDate(parent.createdAt)}「${esc(snippet(parent.text, 24)) || '投稿'}」への返信</a>` : '';
  const nReplies = (replyIndex.get(p.id) || []).length;
  return `
  <article class="post ${p.kind === 'checkin' ? 'checkin' : ''} ${inThread ? 'in-thread' : ''}" data-id="${p.id}">
    <div class="avatar">${p.kind === 'checkin' ? I.flag : avatarHTML()}</div>
    <div class="post-main">
      <div class="post-head"><span class="name">${esc(settings.name)}</span><span>@${esc(settings.handle)}</span><span>·</span>${time}<span class="wx" data-wx-for="${p.id}">${wxText(p.weather)}</span></div>
      ${ctx}${text}${media}${quoteHTML(p)}${loc}
      <div class="post-actions">
        <button class="icon-btn" data-action="reply" title="続きを書く（返信）">${I.reply}<span class="n">${!inThread && nReplies ? nReplies : ''}</span></button>
        <button class="icon-btn" data-action="quote" title="引用して書く">${I.quote}</button>
        <button class="icon-btn ${p.fav ? 'liked' : ''}" data-action="fav" title="お気に入り">${I.heart}</button>
        <a class="icon-btn" href="#/day/${p.day}" title="この日の日記帳">${I.book}</a>
        <button class="icon-btn" data-action="more" title="その他">${I.more}</button>
      </div>
    </div>
  </article>`;
}

// at: 日時を指定（写真の撮影時刻など）/ presetLoc: 位置を指定（写真の撮影場所など）
async function createPost({ text, photos = [], withLoc, day, kind = 'post', at, presetLoc, takenAt, replyTo, quoteOf }) {
  const now = new Date();
  let createdAt = now.getTime();
  if (at) {
    createdAt = at;
  } else if (day && day !== dayKey(now)) {
    const d = parseDay(day);
    d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    createdAt = d.getTime();
  }
  let loc = presetLoc ? { ...presetLoc, source: 'photo' } : null;
  if (!loc && withLoc) {
    try {
      loc = await getPosition();
    } catch (e) {
      if (kind === 'checkin') throw e;
      toast(`${e.message}（位置なしで保存しました）`);
    }
  }
  const photoIds = [];
  for (const b of photos) photoIds.push(await db.addPhoto(b));
  const post = { id: uid(), createdAt, day: dayKey(new Date(createdAt)), text, photos: photoIds, loc, kind, fav: false };
  if (takenAt) post.takenAt = takenAt;
  if (replyTo) post.replyTo = replyTo;
  if (quoteOf) post.quoteOf = quoteOf;
  await db.putPost(post);

  // 地名はあとから非同期で付与
  if (loc && settings.geocode) nameLocation(post.id, loc);
  if (loc && settings.weather) addWeather(post.id);
  return post;
}

async function nameLocation(id, loc) {
  const name = await reverseGeocode(loc.lat, loc.lng);
  const p = await db.getPost(id);
  if (!p?.loc) return;
  // 取れなかったときは時刻を残し、あとで再挑戦する
  p.loc = name ? { ...p.loc, name, geoTriedAt: undefined } : { ...p.loc, geoTriedAt: Date.now() };
  await db.putPost(p);
  if (name) document.querySelectorAll(`[data-loc-for="${id}"] span`).forEach((el) => { el.textContent = name; });
}

// 電波が悪くて地名・天気が付かなかったポストに、あとから付ける
async function retryMissingNames() {
  if (!navigator.onLine) return;
  const dayAgo = Date.now() - 86400000;
  const posts = await db.allPosts();
  if (settings.geocode) {
    const todo = posts.filter((p) => p.loc && !p.loc.name && !(p.loc.geoTriedAt > dayAgo)).slice(0, 20);
    for (const p of todo) await nameLocation(p.id, p.loc);
  }
  if (settings.weather) {
    const todo = posts.filter((p) => p.loc && !p.weather && !(p.weatherTriedAt > dayAgo)).slice(0, 20);
    for (const p of todo) await addWeather(p.id);
  }
}

const wxText = (w) => (w ? `${weatherInfo(w.code).emoji} ${w.temp}℃` : '');

// 天気をあとから非同期で付与
async function addWeather(id) {
  const p = await db.getPost(id);
  if (!p?.loc) return;
  const w = await fetchWeather(p.loc.lat, p.loc.lng, p.createdAt);
  const cur = await db.getPost(id);
  if (!cur) return;
  if (w) { cur.weather = w; delete cur.weatherTriedAt; } else cur.weatherTriedAt = Date.now();
  await db.putPost(cur);
  if (w) document.querySelectorAll(`[data-wx-for="${id}"]`).forEach((el) => { el.textContent = wxText(w); });
}

/* ---------- 投稿フォーム ---------- */
function composerHTML({ day, mode } = {}) {
  const today = dayKey();
  const past = day && day !== today;
  const placeholder = mode === 'reply' ? '続きを書く' : mode === 'quote' ? 'ひとことそえる' : day ? 'この日のできごとは？' : 'いまどうしてる？';
  return `
  <form class="composer" autocomplete="off">
    <div class="avatar">${avatarHTML()}</div>
    <div class="composer-body">
      ${past ? `<div class="when">${fmtDate(parseDay(day).getTime())} の日記として記録</div>` : ''}
      <textarea name="text" rows="2" placeholder="${placeholder}"></textarea>
      <div class="thumbs"></div>
      <div class="photo-meta" hidden></div>
      <div class="composer-tools">
        <label class="icon-btn" title="写真を追加">${I.photo}<input type="file" accept="image/*" multiple hidden></label>
        <button type="button" class="icon-btn loc-toggle" title="位置情報をつける" aria-label="位置情報をつける">${I.pin}</button>
        ${past || mode ? '' : `<button type="button" class="icon-btn checkin" title="いまいる場所を記録">${I.flag}<span>チェックイン</span></button>`}
        <span class="spacer"></span>
        <span class="count"></span>
        <button class="btn" type="submit" disabled>${mode === 'reply' ? '返信' : 'ポスト'}</button>
      </div>
    </div>
  </form>`;
}

const DRAFT_KEY = 'daylog.draft.';
function loadDraft(key) { try { return localStorage.getItem(DRAFT_KEY + key) || ''; } catch { return ''; } }
function saveDraft(key, text) {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_KEY + key, text);
    else localStorage.removeItem(DRAFT_KEY + key);
  } catch { /* 保存できない環境 */ }
}

// draftKey: 書きかけを自動保存するときのキー / replyTo・quoteOf: 返信・引用
function bindComposer(form, { day, onPosted, draftKey, replyTo, quoteOf }) {
  const ta = form.querySelector('textarea');
  const thumbs = form.querySelector('.thumbs');
  const submit = form.querySelector('[type=submit]');
  const count = form.querySelector('.count');
  const locBtn = form.querySelector('.loc-toggle');
  const checkinBtn = form.querySelector('.checkin');
  const fileInput = form.querySelector('input[type=file]');
  const metaEl = form.querySelector('.photo-meta');
  const past = day && day !== dayKey();
  let photos = []; // { blob, meta: { time?, loc? } | null }
  let usePhotoMeta = true;
  // 写真の撮影場所・日時（位置つきの写真を優先）
  const photoMeta = () => photos.find((p) => p.meta?.loc)?.meta || photos.find((p) => p.meta?.time)?.meta || null;
  let locOn = settings.autoLocation && !past;
  let busy = false;

  const refresh = () => {
    const n = ta.value.trim().length;
    count.textContent = n ? n : '';
    submit.disabled = busy || (!n && !photos.length);
    locBtn.classList.toggle('on', locOn);
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  };
  const renderThumbs = () => {
    thumbs.innerHTML = photos.map((p, i) =>
      `<div class="thumb"><img src="${blobURL(p.blob)}" alt=""><button type="button" data-i="${i}" aria-label="削除">✕</button></div>`).join('');
    const m = photoMeta();
    metaEl.hidden = !m;
    if (m) {
      const what = [m.loc && '場所', m.time && '日時'].filter(Boolean).join('と');
      metaEl.innerHTML = `<button type="button" class="meta-chip ${usePhotoMeta ? 'on' : ''}">
        <span class="check">${usePhotoMeta ? '✓' : ''}</span>📷 写真を撮った${what}で記録
        ${m.time ? `<small>${fmtDate(m.time)} ${fmtTime(m.time)}</small>` : ''}</button>`;
    }
  };
  metaEl.addEventListener('click', () => { usePhotoMeta = !usePhotoMeta; renderThumbs(); });

  ta.addEventListener('input', refresh);
  if (draftKey) {
    ta.value = loadDraft(draftKey);
    let saveTimer;
    ta.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveDraft(draftKey, ta.value), 300);
    });
  }
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
  });
  locBtn.addEventListener('click', () => { locOn = !locOn; refresh(); });
  thumbs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    photos.splice(+b.dataset.i, 1);
    renderThumbs(); refresh();
  });
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files].slice(0, 4 - photos.length);
    fileInput.value = '';
    for (const f of files) {
      const meta = await readExif(f); // 縮小すると情報が消えるので先に読む
      photos.push({ blob: await resizeImage(f), meta });
    }
    if (photos.length >= 4) toast('写真は1ポスト4枚までです');
    renderThumbs(); refresh();
  });

  const send = async (kind) => {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    const m = kind === 'post' && usePhotoMeta ? photoMeta() : null;
    const withLoc = kind === 'checkin' || (locOn && !m);
    if (withLoc) toast('現在地を取得中…');
    try {
      await createPost({
        text: ta.value.trim(), photos: photos.map((p) => p.blob), withLoc, day, kind,
        at: m?.time, presetLoc: m?.loc, takenAt: m ? photoKey(m) : undefined, replyTo, quoteOf,
      });
      ta.value = '';
      if (draftKey) saveDraft(draftKey, '');
      photos = [];
      usePhotoMeta = true;
      renderThumbs();
      toast(kind === 'checkin' ? 'チェックインしました' : replyTo ? '返信しました' : 'ポストしました');
      onPosted?.();
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
      refresh();
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); send('post'); });
  checkinBtn?.addEventListener('click', () => send('checkin'));
  refresh();
}

/* ---------- ポスト操作（イベント委譲） ---------- */
view.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const article = btn.closest('.post');
  const id = article?.dataset.id;
  switch (btn.dataset.action) {
    case 'zoom':
      if (!btn.src) return;
      openDialog(`<img src="${btn.src}" alt="">`, 'lightbox');
      break;
    case 'fav': {
      const p = await db.getPost(id);
      p.fav = !p.fav;
      await db.putPost(p);
      btn.classList.toggle('liked', p.fav);
      break;
    }
    case 'reply':
      await openComposeDialog('reply', id);
      break;
    case 'quote':
      await openComposeDialog('quote', id);
      break;
    case 'more':
      await openPostMenu(id);
      break;
  }
});

// 返信・引用の入力画面
async function openComposeDialog(mode, id) {
  const target = await db.getPost(id);
  if (!target) return;
  const rootId = target.replyTo || target.id; // 返信はいつも一番上のポストにつなげる
  const preview = `<div class="compose-target">
      <div class="q-head"><span class="avatar mini">${avatarHTML()}</span><b>${esc(settings.name)}</b><span>· ${fmtDate(target.createdAt)} ${fmtTime(target.createdAt)}</span></div>
      <div class="q-text">${esc(snippet(target.text, 120)) || (target.photos?.length ? '📷 写真' : '📍 チェックイン')}</div>
    </div>`;
  openDialog(`
    <div class="dlg-head">${mode === 'reply' ? '💬 続きを書く' : '🔁 引用して書く'}</div>
    <div class="dlg-body compose-dlg">${mode === 'reply' ? preview : ''}${composerHTML({ mode })}${mode === 'quote' ? preview : ''}</div>
    <div class="dlg-foot"><button class="btn secondary" type="button" data-close>閉じる</button></div>`);
  const d = $('#dialog');
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  bindComposer(d.querySelector('.composer'), {
    replyTo: mode === 'reply' ? rootId : undefined,
    quoteOf: mode === 'quote' ? id : undefined,
    onPosted: () => { d.close(); router(); },
  });
  d.querySelector('textarea').focus();
}

// 「⋯」メニュー：編集・共有・Xに投稿・削除
async function openPostMenu(id) {
  const p = await db.getPost(id);
  if (!p) return;
  const choice = await openDialog(`
    <form method="dialog" class="menu">
      <button value="edit">${I.edit}<span>編集する</span></button>
      <button value="share">${I.share}<span>共有する（LINE・メッセージなど）</span></button>
      <button value="x"><b class="x-logo">𝕏</b><span>Xにも投稿する</span></button>
      <button value="delete" class="danger">${I.trash}<span>削除する</span></button>
      <button value="cancel" class="cancel">キャンセル</button>
    </form>`, 'sheet');
  if (choice === 'edit') await editPost(id);
  else if (choice === 'share') await sharePost(id);
  else if (choice === 'x') await postToX(p);
  else if (choice === 'delete') await deletePostWithReplies(p);
}

async function deletePostWithReplies(p) {
  const replies = (await db.allPosts()).filter((x) => x.replyTo === p.id);
  const msg = replies.length ? `このポストと、つながっている返信${replies.length}件を削除しますか？` : 'このポストを削除しますか？';
  if (!confirm(msg)) return;
  for (const r of replies) await db.deletePost(r.id);
  await db.deletePost(p.id);
  toast('削除しました');
  router();
}

// Xの投稿画面を開く（文章だけ。写真と場所は送らない）
async function postToX(p) {
  if (!p.text) { toast('文章のない投稿はXに出せません'); return; }
  const ok = await openDialog(`
    <form method="dialog">
      <div class="dlg-head">𝕏 Xにも投稿</div>
      <div class="dlg-body"><div class="field">
        <div class="x-preview">${esc(p.text)}</div>
        <div class="help">Xの投稿画面がこの文章入りで開きます。Xで「ポスト」を押すまでは公開されません。写真と場所は送られません（写真も出したいときは「共有する」から）。</div>
      </div></div>
      <div class="dlg-foot"><button class="btn secondary" value="cancel">やめる</button><button class="btn" value="ok">Xを開く</button></div>
    </form>`);
  if (ok !== 'ok') return;
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(p.text)}`, '_blank', 'noopener');
}

async function editPost(id) {
  const p = await db.getPost(id);
  const time = new Date(p.createdAt);
  const local = new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const result = await openDialog(`
    <form method="dialog">
      <div class="dlg-head">ポストを編集</div>
      <div class="dlg-body">
        <div class="field"><textarea name="text" rows="5" style="font-family:inherit;font-size:15px">${esc(p.text)}</textarea></div>
        <div class="field"><label>日時</label><input type="datetime-local" name="when" value="${local}" style="font:inherit;color:var(--text);background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;padding:8px 10px"></div>
        ${p.loc ? `<div class="field row"><span>位置情報を削除</span><label class="switch"><input type="checkbox" name="dropLoc"><span></span></label></div>` : ''}
      </div>
      <div class="dlg-foot">
        <button class="btn secondary" value="cancel">キャンセル</button>
        <button class="btn" value="ok">保存</button>
      </div>
    </form>`);
  if (result !== 'ok') return;
  const f = $('#dialog form');
  p.text = f.text.value.trim();
  const when = new Date(f.when.value);
  if (!Number.isNaN(when.getTime())) {
    p.createdAt = when.getTime();
    p.day = dayKey(when);
  }
  if (f.dropLoc?.checked) p.loc = null;
  await db.putPost(p);
  toast('保存しました');
  router();
}

async function sharePost(id) {
  const p = await db.getPost(id);
  const text = [p.text, p.loc?.name && `📍${p.loc.name}`].filter(Boolean).join('\n');
  const blobs = (await Promise.all((p.photos || []).map((id) => db.getPhoto(id)))).filter(Boolean);
  const files = blobs.map((b, i) => new File([b], `photo${i + 1}.jpg`, { type: b.type || 'image/jpeg' }));
  const data = { text };
  if (files.length && navigator.canShare?.({ files })) data.files = files;
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(text); toast('コピーしました'); }
  } catch { /* キャンセル */ }
}

/* ================= ダイアログ ================= */
function openDialog(html, cls = '') {
  const d = $('#dialog');
  d.className = cls;
  d.innerHTML = html;
  d.returnValue = '';
  d.onclick = (e) => { if (e.target === d || cls === 'lightbox') d.close(); };
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue), { once: true }));
}

/* ================= ホーム（タイムライン） ================= */
const PAGE = 40;

async function renderHome(query, alive) {
  const [posts, todayRec] = await Promise.all([db.allPosts(), db.getDay(dayKey())]);
  if (!alive()) return;
  posts.sort((a, b) => b.createdAt - a.createdAt);
  indexPosts(posts);
  const st = streakOf(posts);
  setChrome(query ? '検索' : 'ホーム', 'home', !query && st.current
    ? `<button class="streak ${st.todayDone ? '' : 'pending'}" id="streak">🔥 ${st.current}日</button>` : '');
  $('#streak')?.addEventListener('click', () => toast(st.todayDone
    ? `${st.current}日連続で記録中！（最長 ${st.best}日）`
    : `今日書くと${st.current + 1}日連続！（最長 ${st.best}日）`, 3500));

  view.innerHTML = `
    ${query ? '' : backupNoticeHTML(posts)}
    ${query || todayRec?.mood ? '' : `<div class="mood-card"><b>今日の気分は？</b><div class="moods">${moodButtonsHTML(null)}</div></div>`}
    ${query ? '' : composerHTML()}
    <div class="search"><input type="search" placeholder="キーワード・#タグ・場所で検索" value="${esc(query)}"></div>
    <div id="feed"></div>`;
  if (!query) bindComposer(view.querySelector('.composer'), { onPosted: router, draftKey: 'home' });
  const moodCard = view.querySelector('.mood-card');
  if (moodCard) {
    bindMoodButtons(moodCard, dayKey(), (v) => {
      if (!v) return;
      toast(`今日の気分を「${moodOf(v).label}」で記録しました`);
      moodCard.classList.add('done');
      setTimeout(() => moodCard.remove(), 400);
    });
  }
  view.querySelectorAll('[data-bk]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.bk === 'now') {
      await exportBackup();
    } else {
      settings.backupSnoozeUntil = Date.now() + 3 * 86400000;
      saveSettings();
      view.querySelector('.notice')?.remove();
    }
  }));

  const feed = $('#feed');
  const draw = (q) => {
    const needle = q.trim().toLowerCase();
    // ふだんはスレッド単位（返信があると上に上がる）、検索中は一致したポストを1つずつ
    const lastActivity = (r) => Math.max(r.createdAt, ...(replyIndex.get(r.id) || []).map((x) => x.createdAt));
    const list = needle
      ? posts.filter((p) => (p.text || '').toLowerCase().includes(needle) || (p.loc?.name || '').toLowerCase().includes(needle))
      : posts.filter(isRoot).sort((a, b) => lastActivity(b) - lastActivity(a));
    let shown = 0;
    const more = () => {
      const chunk = list.slice(shown, shown + PAGE);
      shown += chunk.length;
      feed.querySelector('.more')?.remove();
      feed.insertAdjacentHTML('beforeend', chunk.map((p) => (needle ? postHTML(p, { context: true }) : threadHTML(p))).join(''));
      hydratePhotos(feed);
      if (shown < list.length) {
        feed.insertAdjacentHTML('beforeend', '<div class="empty more"><button class="btn secondary">もっと見る</button></div>');
        feed.querySelector('.more button').onclick = more;
      }
    };
    feed.innerHTML = list.length ? '' : (needle
      ? '<div class="empty"><span class="emoji">🔍</span><strong>見つかりませんでした</strong>別のキーワードで試してください</div>'
      : '<div class="empty"><span class="emoji">🐣</span><strong>ようこそ Daylog へ</strong>いまの気持ちや、行った場所をつぶやいてみましょう。</div>');
    more();
  };
  let t;
  view.querySelector('.search input').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => draw(e.target.value), 150);
  });
  draw(query);
}

/* ================= 日記帳（1日1ページ） ================= */
async function renderDay(day, alive) {
  const today = dayKey();
  setChrome('日記帳', 'day', day !== today ? '<a class="btn small secondary" href="#/day">今日</a>' : '');
  const [posts, all, dayRec] = await Promise.all([db.postsByDay(day), db.allPosts(), db.getDay(day)]);
  if (!alive()) return;
  posts.sort((a, b) => a.createdAt - b.createdAt);
  indexPosts(all);
  // この日のできごと：この日のポスト（返信つき）＋ 別の日のポストへのこの日の返信
  const diaryItems = posts.filter((p) => isRoot(p) || postIndex.get(p.replyTo).day !== day);
  // その日の天気：昼に近い投稿の天気 ＋ 気温の幅
  const wxPosts = posts.filter((p) => p.weather);
  const mainWx = wxPosts.slice().sort((a, b) => Math.abs(new Date(a.createdAt).getHours() - 13) - Math.abs(new Date(b.createdAt).getHours() - 13))[0]?.weather;
  const temps = wxPosts.map((p) => p.weather.temp);
  const dayWx = mainWx ? `${weatherInfo(mainWx.code).emoji} ${weatherInfo(mainWx.code).label}　${Math.min(...temps) === Math.max(...temps) ? `${temps[0]}℃` : `${Math.min(...temps)}〜${Math.max(...temps)}℃`}` : '';
  const md = day.slice(5);
  const past = all.filter((p) => p.day.slice(5) === md && p.day < day).sort((a, b) => b.createdAt - a.createdAt);
  const located = posts.filter((p) => p.loc);
  const d = parseDay(day);

  view.innerHTML = `
    <div class="day-head">
      <div class="day-nav">
        <a class="icon-btn" href="#/day/${addDays(day, -1)}" aria-label="前の日">${I.left}</a>
        <div class="date" role="button" tabindex="0">
          <div class="small">${d.getFullYear()}年</div>
          <div class="big">${d.getMonth() + 1}<b>/</b>${d.getDate()}</div>
          <div class="small">${weekday(day)}曜日${day === today ? '<span class="today-badge">今日</span>' : ''}</div>
          ${dayWx ? `<div class="day-wx">${dayWx}</div>` : ''}
          <input type="date" value="${day}" aria-label="日付を選ぶ">
        </div>
        <a class="icon-btn" href="#/day/${addDays(day, 1)}" aria-label="次の日">${I.right}</a>
      </div>
      <div class="mood-row">
        <span class="mood-q">${day === today ? '今日' : 'この日'}の気分</span>
        <div class="moods">${moodButtonsHTML(dayRec?.mood ?? null)}</div>
      </div>
    </div>

    <h2 class="section-title">📝 できごと</h2>
    ${composerHTML({ day })}
    <div class="diary">${diaryItems.map((p) => (isRoot(p)
    ? threadHTML(p, { diary: true, pageDay: day })
    : postHTML(p, { diary: true, pageDay: day, context: true }))).join('') || '<p class="section-sub" style="padding-top:8px">まだ何も書かれていません ✏️</p>'}</div>

    <h2 class="section-title">🐾 足あと
      <label class="btn small secondary title-btn">📷 写真から追加<input type="file" id="photo-trail" accept="image/*" multiple hidden></label></h2>
    ${located.length ? `
      <div class="map-wrap"><div id="daymap" class="map"></div>
        ${located.length > 1 ? `<div class="map-badge">🚶 約${fmtKm(trailKm(located))}km</div>` : ''}</div>
      ${located.length > 1 ? '<p class="section-sub tiny">移動距離は足あとを直線でつないだおおよその距離です</p>' : ''}
      <ol class="places">${located.map((p, i) => `
        <li><span class="num">${i + 1}</span><span class="t">${fmtTime(p.createdAt)}</span><span class="n"><span data-loc-for="${p.id}"><span>${esc(p.loc.name || '（地名を取得できませんでした）')}</span></span></span></li>`).join('')}
      </ol>` : '<p class="section-sub">この日の足あとはまだありません。おでかけ先でチェックインするか、「写真から追加」で撮った写真を選ぶと、ここに地図ができます 🐾</p>'}

    ${past.length ? `<h2 class="section-title">🕰️ 過去の${d.getMonth() + 1}月${d.getDate()}日</h2>${past.map((p) => postHTML(p, { context: true })).join('')}` : ''}
  `;

  bindMoodButtons(view.querySelector('.mood-row'), day);
  const dateBox = view.querySelector('.day-head .date');
  const dateInput = dateBox.querySelector('input');
  dateBox.addEventListener('click', () => { try { dateInput.showPicker(); } catch { dateInput.focus(); } });
  dateInput.addEventListener('change', () => { if (isDayKey(dateInput.value)) location.hash = `#/day/${dateInput.value}`; });

  bindComposer(view.querySelector('.composer'), { day, onPosted: router, draftKey: `day:${day}` });
  hydratePhotos(view);
  $('#photo-trail').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await importPhotoTrail(files, day);
  });
  if (located.length) drawDayMap($('#daymap'), located);
}

// 同じ写真を二重に追加しないための目印（撮影日時＋場所）
const photoKey = (meta) => `${meta.time || ''}|${meta.loc?.lat || ''},${meta.loc?.lng || ''}`;

// 写真の撮影場所・日時から、まとめてポストを作る
async function importPhotoTrail(files, currentDay) {
  toast(`${files.length}枚の写真を読み込み中…`, 60000);
  const known = new Set((await db.allPosts()).map((p) => p.takenAt).filter(Boolean));
  const items = [];
  let noInfo = 0;
  let dup = 0;
  for (const f of files) {
    const meta = await readExif(f);
    if (!meta) { noInfo++; continue; }
    const key = photoKey(meta);
    if (known.has(key)) { dup++; continue; }
    known.add(key);
    items.push({ f, meta, key });
  }
  items.sort((a, b) => (a.meta.time || 0) - (b.meta.time || 0));
  const days = new Set();
  for (const { f, meta, key } of items) {
    const post = await createPost({
      text: '', photos: [await resizeImage(f)], withLoc: false, day: currentDay,
      at: meta.time, presetLoc: meta.loc, takenAt: key,
    });
    days.add(post.day);
  }
  const notes = [noInfo && `撮影情報なし${noInfo}枚`, dup && `追加済み${dup}枚`].filter(Boolean).join('・');
  toast(items.length
    ? `${items.length}枚を足あとに追加しました${notes ? `（${notes}はスキップ）` : ''}`
    : `追加できる写真がありませんでした${notes ? `（${notes}）` : ''}`, 4000);
  // 写真が1日分ならその日を開く
  const only = days.size === 1 ? [...days][0] : null;
  if (only && only !== currentDay) location.hash = `#/day/${only}`;
  else router();
}

async function drawDayMap(el, located) {
  try {
    await createMap(el, located, {
      maxZoom: 16,
      makePin: (p, i) => pinEl('map-pin', `<span><b>${i + 1}</b></span>`),
      popupHTML: (p) => `<b>${fmtTime(p.createdAt)}</b> ${esc(p.loc.name || '')}${p.text ? `<br>${esc(p.text.slice(0, 80))}` : ''}`,
      // 移動した順に点線（足あと）でつなぐ
      onLoad: (map, coords) => {
        if (coords.length < 2) return;
        map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
        map.addLayer({
          id: 'route', type: 'line', source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#3fa9f5', 'line-width': 6, 'line-dasharray': [0, 2] },
        });
      },
    });
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* ================= カレンダー ================= */
async function renderCalendar(ym, alive) {
  const thisMonth = dayKey().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) ym = thisMonth;
  setChrome('カレンダー', 'calendar', ym !== thisMonth ? '<a class="btn small secondary" href="#/calendar">今月</a>' : '');
  const [y, m] = ym.split('-').map(Number);
  const [posts, dayRecs] = await Promise.all([db.allPosts(), db.allDays()]);
  if (!alive()) return;
  const moods = new Map(dayRecs.filter((r) => r.mood).map((r) => [r.date, r.mood]));
  const st = streakOf(posts);

  const byDay = new Map();
  for (const p of posts) {
    if (!p.day.startsWith(ym)) continue;
    const e = byDay.get(p.day) || { n: 0, loc: 0 };
    e.n++;
    if (p.loc) e.loc++;
    byDay.set(p.day, e);
  }
  const monthPosts = [...byDay.values()].reduce((s, e) => s + e.n, 0);
  const monthKm = trailKm(posts.filter((p) => p.day.startsWith(ym)));

  const first = new Date(y, m - 1, 1);
  const daysIn = new Date(y, m, 0).getDate();
  const today = dayKey();
  const prev = dayKey(new Date(y, m - 2, 1)).slice(0, 7);
  const next = dayKey(new Date(y, m, 1)).slice(0, 7);

  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<a class="out"></a>';
  for (let dd = 1; dd <= daysIn; dd++) {
    const key = `${ym}-${String(dd).padStart(2, '0')}`;
    const e = byDay.get(key);
    const dots = e ? Array.from({ length: Math.min(e.n, 6) }, (_, i) => `<i class="${i < e.loc ? 'loc' : ''}"></i>`).join('') : '';
    const mood = moodOf(moods.get(key));
    cells += `<a href="#/day/${key}" class="${e ? 'has' : ''} ${key === today ? 'today' : ''}">
      <span class="d">${dd}</span>
      ${mood ? `<span class="mood" title="${mood.label}">${mood.e}</span>` : ''}
      <span class="dots">${dots}</span></a>`;
  }

  view.innerHTML = `
    <div class="cal-head">
      <a class="icon-btn" href="#/calendar/${prev}" aria-label="前の月">${I.left}</a>
      <span class="m">${y}年${m}月</span>
      <a class="icon-btn" href="#/calendar/${next}" aria-label="次の月">${I.right}</a>
    </div>
    <div class="cal">${[...'日月火水木金土'].map((w) => `<div class="wd">${w}</div>`).join('')}${cells}</div>
    <div class="stat-grid">
      <div class="stat-tile"><div class="label">ポスト</div><div class="value">${monthPosts}<span class="unit">件</span></div></div>
      <div class="stat-tile"><div class="label">書いた日</div><div class="value">${byDay.size}<span class="unit">日</span></div></div>
      <div class="stat-tile"><div class="label">足あと</div><div class="value">${[...byDay.values()].reduce((n, e) => n + e.loc, 0)}<span class="unit">か所</span></div><div class="sub">🚶 約${fmtKm(monthKm)}km</div></div>
      <div class="stat-tile"><div class="label">🔥 連続記録</div><div class="value">${st.current}<span class="unit">日</span></div></div>
      <div class="stat-tile"><div class="label">最長記録</div><div class="value">${st.best}<span class="unit">日</span></div></div>
      <div class="stat-tile"><div class="label">今月の気分</div><div class="value">${monthMood(moods, ym)}</div></div>
    </div>
    <div class="legend"><span><i></i>ポスト</span><span><i class="loc"></i>位置つき</span></div>`;
}

// その月でいちばん多かった気分
function monthMood(moods, ym) {
  const count = new Map();
  for (const [d, v] of moods) if (d.startsWith(ym)) count.set(v, (count.get(v) || 0) + 1);
  if (!count.size) return '–';
  const [v] = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return `<span class="mood-big">${moodOf(v).e}</span><span class="unit">${moodOf(v).label}</span>`;
}

/* ================= 足あとマップ ================= */
async function renderMap(range, alive) {
  range = ['30', '365', 'all'].includes(range) ? range : 'all';
  setChrome('足あと', 'map', `
    <select id="range" class="btn small secondary" aria-label="期間">
      <option value="30" ${range === '30' ? 'selected' : ''}>30日</option>
      <option value="365" ${range === '365' ? 'selected' : ''}>1年</option>
      <option value="all" ${range === 'all' ? 'selected' : ''}>全期間</option>
    </select>`);
  $('#range').addEventListener('change', (e) => { location.hash = `#/map/${e.target.value}`; });

  const since = range === 'all' ? 0 : Date.now() - Number(range) * 86400000;
  const located = (await db.allPosts()).filter((p) => p.loc && p.createdAt >= since).sort((a, b) => a.createdAt - b.createdAt);
  if (!alive()) return;

  if (!located.length) {
    view.innerHTML = '<div class="empty"><span class="emoji">🐾</span><strong>まだ足あとがありません</strong>ポストに位置情報をつけるか、チェックインしてみましょう。</div>';
    return;
  }
  const places = new Set(located.map((p) => `${p.loc.lat.toFixed(3)},${p.loc.lng.toFixed(3)}`)).size;
  view.innerHTML = `<div class="map-wrap"><div id="bigmap" class="map tall"></div>
    <div class="map-badge">🐾 ${places}か所 ・ 🚶 約${fmtKm(trailKm(located))}km</div></div>`;
  try {
    await createMap($('#bigmap'), located, {
      maxZoom: 15,
      makePin: () => pinEl('paw', '🐾'),
      popupHTML: (p) => `<a href="#/day/${p.day}"><b>${fmtDate(p.createdAt)} ${fmtTime(p.createdAt)}</b></a><br>${esc(p.loc.name || '')}${p.text ? `<br>${esc(p.text.slice(0, 80))}` : ''}`,
    });
  } catch (e) {
    view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* ================= 設定 ================= */
async function renderSettings(alive) {
  setChrome('設定', 'settings');
  let storage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    if (est) storage = `使用量 ${(est.usage / 1048576).toFixed(1)} MB${persisted ? '（消去されにくい保存領域）' : ''}`;
  } catch { /* ignore */ }
  if (!alive()) return;

  view.innerHTML = `
  <div class="settings">
    <h2 class="section-title">📖 使い方</h2>
    <div class="group guide">
      <details class="howto">
        <summary>つぶやく</summary>
        <ul>
          <li><b>ホーム</b>の「いまどうしてる？」に書いて<b>ポスト</b>。</li>
          <li>🖼 で写真を4枚までつけられます。</li>
          <li>📍 が青いときは、いまいる場所も一緒に記録されます。タップでオン／オフ。</li>
          <li><code>#おでかけ</code> のように書くとタグになり、タップすると同じタグの投稿が出てきます。</li>
          <li>💬 <b>続きを書く</b>：自分の投稿に返信して、Xのスレッドのようにつなげられます。あとから思ったことや続報に。</li>
          <li>🔁 <b>引用して書く</b>：過去の投稿を引用して、ひとことそえられます。「1年前の自分」へのツッコミにも。</li>
          <li>♡ でお気に入り。<b>⋯</b> から編集・共有・削除ができます。</li>
          <li><b>Xにも投稿</b>：⋯ →「Xにも投稿する」で、その文章入りのXの投稿画面が開きます。人に見せてもいいものだけ選んで出せます（写真と場所は送られません）。</li>
          <li>書きかけの文章は自動で保存されるので、別の画面に移っても消えません。</li>
        </ul>
      </details>
      <details class="howto">
        <summary>行った場所を残す（足あと）</summary>
        <ul>
          <li>🏳 <b>チェックイン</b>：文章なしで、いまいる場所だけを記録します。</li>
          <li><b>写真の場所で記録</b>：撮影場所つきの写真を選ぶと「📷 写真を撮った場所と日時で記録」が出て、その時間・場所で投稿されます。</li>
          <li><b>あとからまとめて</b>：日記帳の「足あと」にある <b>📷 写真から追加</b> で、その日の写真をまとめて選ぶと、撮った順に地図に並びます。同じ写真は二重に入りません。</li>
          <li>アプリを閉じている間は位置を記録できません。出かけた先でチェックインするか、夜に写真から追加するのがおすすめです。</li>
        </ul>
      </details>
      <details class="howto">
        <summary>日記帳・カレンダー・足あと</summary>
        <ul>
          <li><b>今日の気分</b>：ホームの「今日の気分は？」か、日記帳の日付の下で 😆〜😢 を選びます。もう一度押すと取り消し。カレンダーにも表示されます。</li>
          <li><b>天気</b>：位置つきで投稿すると、その時の天気と気温が自動で記録されます（投稿の時刻の横と、日記帳の日付の下に表示）。</li>
          <li><b>🔥 連続記録</b>：毎日投稿すると、ホーム右上に何日続いているかが出ます。タップすると最長記録も見られます。</li>
          <li><b>日記帳</b>：1日1ページ。その日のできごとと、行った場所の地図が並びます。下には「過去の同じ日」も出ます。</li>
          <li>‹ › で前後の日へ。真ん中の日付をタップすると日付を選べます。</li>
          <li>過去の日のページで書くと、その日の日記として残せます。</li>
          <li><b>カレンダー</b>：書いた日に●がつきます（緑は位置つき）。日付をタップするとその日の日記帳へ。</li>
          <li><b>足あと</b>タブ：これまで行った場所を全部地図に表示します。右上で期間を切り替えられます。</li>
        </ul>
      </details>
      <details class="howto">
        <summary>アプリとして使う</summary>
        <ul>
          <li>iPhone の Safari でこのページを開き、<b>共有 → ホーム画面に追加</b>。</li>
          <li>初めて位置を使うときに許可を聞かれたら「許可」を選んでください。あとから変えるときは iPhone の 設定 → Safari（またはプライバシー → 位置情報サービス）。</li>
          <li>アプリが新しくなったら、一度アプリを完全に閉じて開き直すと反映されます。</li>
        </ul>
      </details>
      <details class="howto">
        <summary>データとバックアップ</summary>
        <ul>
          <li>日記・写真はこの iPhone の中だけに保存され、どこにも送られません。</li>
          <li>場所の名前を調べるときは座標が OpenStreetMap に、天気を調べるときはおおよその場所（約1km）と日時が Open-Meteo に送られます。どちらも下の位置情報の設定でオフにできます。</li>
          <li>iPhone が壊れたり、ホーム画面からアプリを消したりすると日記も消えます。ときどき <b>バックアップ → 書き出す</b> で保存してください。2週間たつとホームでお知らせします。</li>
          <li>機種変更のときは、書き出したファイルを新しい iPhone で <b>読み込む</b>。</li>
        </ul>
      </details>
    </div>

    <h2 class="section-title">👤 プロフィール</h2>
    <div class="group">
    <div class="field row avatar-field">
      <div class="avatar big">${avatarHTML()}</div>
      <div class="avatar-actions">
        <span class="label">アイコン</span>
        <div class="btn-row">
          <label class="btn small">画像を選ぶ<input type="file" id="s-avatar" accept="image/*" hidden></label>
          ${settings.avatarImage ? '<button type="button" class="btn small secondary" id="s-avatar-clear">外す</button>' : ''}
        </div>
        <div class="help">正方形に切り抜かれます</div>
      </div>
    </div>
    <div class="field"><label for="s-name">表示名</label><input id="s-name" type="text" value="${esc(settings.name)}"></div>
    <div class="field"><label for="s-handle">ユーザー名</label><input id="s-handle" type="text" value="${esc(settings.handle)}"></div>
    </div>

    <h2 class="section-title">📍 位置情報</h2>
    <div class="group">
    <div class="field row"><div><div class="label">ポストに位置をつける</div><div class="help">新しいポストの位置ボタンを最初からONにします</div></div>
      <label class="switch"><input type="checkbox" id="s-autoloc" ${settings.autoLocation ? 'checked' : ''}><span></span></label></div>
    <div class="field row"><div><div class="label">地名を調べる</div><div class="help">座標を OpenStreetMap に送り、地名に変換します</div></div>
      <label class="switch"><input type="checkbox" id="s-geocode" ${settings.geocode ? 'checked' : ''}><span></span></label></div>
    <div class="field row"><div><div class="label">天気を記録する</div><div class="help">位置つきで投稿したとき、おおよその場所（約1km）と日時を Open-Meteo に送り、天気と気温を調べます</div></div>
      <label class="switch"><input type="checkbox" id="s-weather" ${settings.weather ? 'checked' : ''}><span></span></label></div>
    </div>

    <h2 class="section-title">💾 バックアップ</h2>
    <div class="group"><div class="field">
      <div class="help">データはこの端末の中だけに保存されています。機種変更やもしもに備えて、ときどき書き出してください。
        <br>前回のバックアップ：${settings.lastBackupAt ? fmtDate(settings.lastBackupAt) : 'まだありません'}${storage ? `<br>${storage}` : ''}</div>
      <div class="btn-row">
        <button class="btn small" id="b-export">書き出す</button>
        <label class="btn small secondary">読み込む<input type="file" id="b-import" accept=".json,application/json" hidden></label>
      </div>
    </div></div>

    <h2 class="section-title">🧹 その他</h2>
    <div class="group"><div class="field"><div class="btn-row"><button class="btn small danger" id="wipe">すべてのデータを削除</button></div></div></div>
    <p class="section-sub" style="padding-top:12px">Daylog v1.5</p>
  </div>`;

  const bindText = (id, key) => $(id).addEventListener('change', (e) => {
    settings[key] = e.target.value.trim() || DEFAULTS[key];
    saveSettings();
    toast('保存しました');
  });
  bindText('#s-name', 'name');
  bindText('#s-handle', 'handle');
  $('#s-avatar-clear')?.addEventListener('click', () => {
    settings.avatarImage = '';
    saveSettings();
    toast('アイコンを外しました');
    router();
  });
  $('#s-avatar').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      settings.avatarImage = await squareImageDataURL(file);
      saveSettings();
      toast('アイコンを変更しました');
      router();
    } catch {
      toast('画像を読み込めませんでした');
    }
  });
  $('#s-autoloc').addEventListener('change', (e) => {
    settings.autoLocation = e.target.checked;
    saveSettings();
    if (e.target.checked) getPosition().catch((err) => toast(err.message)); // 許可ダイアログを先に出す
  });
  $('#s-geocode').addEventListener('change', (e) => { settings.geocode = e.target.checked; saveSettings(); });
  $('#s-weather').addEventListener('change', (e) => { settings.weather = e.target.checked; saveSettings(); });

  $('#b-export').addEventListener('click', exportBackup);
  $('#b-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importBackup(file);
  });
  $('#wipe').addEventListener('click', async () => {
    if (!confirm('すべてのポストと写真を削除します。元に戻せません。よろしいですか？')) return;
    if (!confirm('本当に削除しますか？（先にバックアップを書き出すことをおすすめします）')) return;
    await db.clearAll();
    toast('すべて削除しました');
    location.hash = '#/';
  });
}

function backupNoticeHTML(posts) {
  if (!posts.length || settings.backupSnoozeUntil > Date.now()) return '';
  const base = settings.lastBackupAt || posts.reduce((m, p) => Math.min(m, p.createdAt), Infinity);
  const days = Math.floor((Date.now() - base) / 86400000);
  if (days < 14) return '';
  return `<div class="notice">
    <div><b>💾 ${settings.lastBackupAt ? `前回のバックアップから${days}日たちました` : 'まだバックアップがありません'}</b>
    <div class="help">iPhoneが壊れたり機種変更したりしても日記が消えないように、書き出しておきましょう。</div></div>
    <div class="btn-row"><button class="btn small" data-bk="now">書き出す</button><button class="btn small secondary" data-bk="later">あとで</button></div>
  </div>`;
}

function markBackedUp() {
  settings.lastBackupAt = Date.now();
  settings.backupSnoozeUntil = 0;
  saveSettings();
  document.querySelector('.notice')?.remove();
}

async function exportBackup() {
  toast('書き出し中…');
  const [posts, health] = await Promise.all([db.allPosts(), db.allHealth()]);
  const photosOf = async (p) => {
    const blobs = await Promise.all((p.photos || []).map((id) => db.getPhoto(id)));
    return Promise.all(blobs.filter(Boolean).map(blobToDataURL));
  };
  const out = {
    app: 'daylog',
    version: 2,
    exportedAt: new Date().toISOString(),
    posts: await Promise.all(posts.map(async (p) => ({ ...p, photos: await photosOf(p) }))),
    health,
    days: await db.allDays(),
    settings,
  };
  const name = `daylog-backup-${dayKey()}.json`;
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); markBackedUp(); toast('書き出しました'); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  markBackedUp();
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'daylog') throw new Error('Daylog のバックアップではありません');
    for (const p of data.posts || []) {
      // 同じポストを読み込み直すときは、古い写真を消してから入れ直す
      const old = await db.getPost(p.id);
      for (const id of old?.photos || []) await db.deletePhoto(id);
      const ids = [];
      for (const url of p.photos || []) ids.push(await db.addPhoto(await dataURLToBlob(url)));
      await db.putPost({ ...p, photos: ids });
    }
    for (const h of data.health || []) await db.putHealth(h);
    for (const d of data.days || []) await db.putDay(d);
    if (data.settings) { settings = { ...DEFAULTS, ...data.settings }; saveSettings(); }
    toast(`${(data.posts || []).length}件のポストを読み込みました`);
    router();
  } catch (e) {
    toast(`読み込めませんでした: ${e.message}`);
  }
}

/* ================= 起動 ================= */
// iOS Safari のピンチによるページ拡大を止める（地図の中は除く）
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => {
    if (!e.target.closest?.('.maplibregl-map')) e.preventDefault();
  }, { passive: false });
}

window.addEventListener('hashchange', () => { router(); window.scrollTo(0, 0); });
window.addEventListener('online', retryMissingNames);
router();
setTimeout(retryMissingNames, 3000);

navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) {
  // 新しい版に切り替わったら1回だけ読み込み直す（初回インストール時は除く）
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // アプリに戻ってきたときも更新を確認する
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}
