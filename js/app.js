import { db } from './db.js';
import { getPosition, reverseGeocode } from './location.js';
import { HEALTH_FIELDS, parseHealthText, formatValue } from './health.js';
import {
  $, esc, uid, dayKey, parseDay, addDays, isDayKey, weekday, fmtTime, fmtDate, fmtRelative,
  linkify, toast, resizeImage, blobToDataURL, dataURLToBlob, loadMapLibre,
} from './util.js';

/* ================= 設定 ================= */
const SETTINGS_KEY = 'daylog.settings';
const DEFAULTS = { name: 'わたし', handle: 'me', avatar: '🐣', autoLocation: true, geocode: true };
const AVATARS = ['🐣', '🐻', '🐰', '🐱', '🐶', '🐼', '🦊', '🐸', '🐧', '🌷', '🍓', '☕️'];
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}
let settings = loadSettings();
const initial = () => settings.avatar || Array.from((settings.name || '?').trim())[0] || '?';

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
  left: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
};

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
function cleanup() {
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
function postHTML(p, { diary = false } = {}) {
  const photos = p.photos || [];
  const media = photos.length
    ? `<div class="media n${Math.min(photos.length, 4)}">${photos.slice(0, 4)
      .map((b) => `<img src="${blobURL(b)}" loading="lazy" alt="" data-action="zoom">`).join('')}</div>`
    : '';
  const locName = p.loc ? (p.loc.name || `${p.loc.lat.toFixed(4)}, ${p.loc.lng.toFixed(4)}`) : '';
  const loc = p.loc
    ? `<a class="loc-chip" data-loc-for="${p.id}" href="#/day/${p.day}">${I.pin}<span>${esc(locName)}</span></a>`
    : '';
  const text = p.text
    ? `<div class="post-text">${linkify(p.text)}</div>`
    : (p.kind === 'checkin' ? '<div class="post-text">チェックインしました</div>' : '');
  const time = diary
    ? `<span class="time">${fmtTime(p.createdAt)}</span>`
    : `<a class="time" href="#/day/${p.day}">${fmtRelative(p.createdAt)}</a>`;
  return `
  <article class="post ${p.kind === 'checkin' ? 'checkin' : ''}" data-id="${p.id}">
    <div class="avatar">${p.kind === 'checkin' ? I.flag : esc(initial())}</div>
    <div class="post-main">
      <div class="post-head"><span class="name">${esc(settings.name)}</span><span>@${esc(settings.handle)}</span><span>·</span>${time}</div>
      ${text}${media}${loc}
      <div class="post-actions">
        <a class="icon-btn" href="#/day/${p.day}" title="この日の日記帳">${I.book}</a>
        <button class="icon-btn ${p.fav ? 'liked' : ''}" data-action="fav" title="お気に入り">${I.heart}</button>
        <button class="icon-btn" data-action="edit" title="編集">${I.edit}</button>
        <button class="icon-btn" data-action="share" title="共有">${I.share}</button>
        <button class="icon-btn" data-action="delete" title="削除">${I.trash}</button>
      </div>
    </div>
  </article>`;
}

async function createPost({ text, photos, withLoc, day, kind = 'post' }) {
  const now = new Date();
  let createdAt = now.getTime();
  if (day && day !== dayKey(now)) {
    const d = parseDay(day);
    d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    createdAt = d.getTime();
  }
  let loc = null;
  if (withLoc) {
    try {
      loc = await getPosition();
    } catch (e) {
      if (kind === 'checkin') throw e;
      toast(`${e.message}（位置なしで保存しました）`);
    }
  }
  const post = { id: uid(), createdAt, day: dayKey(new Date(createdAt)), text, photos, loc, kind, fav: false };
  await db.putPost(post);

  // 地名はあとから非同期で付与
  if (loc && settings.geocode) {
    reverseGeocode(loc.lat, loc.lng).then(async (name) => {
      if (!name) return;
      const p = await db.getPost(post.id);
      if (!p?.loc) return;
      p.loc = { ...p.loc, name };
      await db.putPost(p);
      document.querySelectorAll(`[data-loc-for="${post.id}"] span`).forEach((el) => { el.textContent = name; });
    });
  }
  return post;
}

/* ---------- 投稿フォーム ---------- */
function composerHTML({ day } = {}) {
  const today = dayKey();
  const past = day && day !== today;
  return `
  <form class="composer" autocomplete="off">
    <div class="avatar">${esc(initial())}</div>
    <div class="composer-body">
      ${past ? `<div class="when">${fmtDate(parseDay(day).getTime())} の日記として記録</div>` : ''}
      <textarea name="text" rows="2" placeholder="${day ? 'この日のできごとは？' : 'いまどうしてる？'}"></textarea>
      <div class="thumbs"></div>
      <div class="composer-tools">
        <label class="icon-btn" title="写真を追加">${I.photo}<input type="file" accept="image/*" multiple hidden></label>
        <button type="button" class="icon-btn loc-toggle" title="位置情報をつける" aria-label="位置情報をつける">${I.pin}</button>
        ${past ? '' : `<button type="button" class="icon-btn checkin" title="いまいる場所を記録">${I.flag}<span>チェックイン</span></button>`}
        <span class="spacer"></span>
        <span class="count"></span>
        <button class="btn" type="submit" disabled>ポスト</button>
      </div>
    </div>
  </form>`;
}

function bindComposer(form, { day, onPosted }) {
  const ta = form.querySelector('textarea');
  const thumbs = form.querySelector('.thumbs');
  const submit = form.querySelector('[type=submit]');
  const count = form.querySelector('.count');
  const locBtn = form.querySelector('.loc-toggle');
  const checkinBtn = form.querySelector('.checkin');
  const fileInput = form.querySelector('input[type=file]');
  const past = day && day !== dayKey();
  let photos = [];
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
    thumbs.innerHTML = photos.map((b, i) =>
      `<div class="thumb"><img src="${blobURL(b)}" alt=""><button type="button" data-i="${i}" aria-label="削除">✕</button></div>`).join('');
  };

  ta.addEventListener('input', refresh);
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
    for (const f of files) photos.push(await resizeImage(f));
    if (photos.length >= 4) toast('写真は1ポスト4枚までです');
    renderThumbs(); refresh();
  });

  const send = async (kind) => {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    if (kind === 'checkin' || locOn) toast('現在地を取得中…');
    try {
      await createPost({ text: ta.value.trim(), photos, withLoc: kind === 'checkin' || locOn, day, kind });
      ta.value = '';
      photos = [];
      renderThumbs();
      toast(kind === 'checkin' ? 'チェックインしました' : 'ポストしました');
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
      openDialog(`<img src="${btn.src}" alt="">`, 'lightbox');
      break;
    case 'fav': {
      const p = await db.getPost(id);
      p.fav = !p.fav;
      await db.putPost(p);
      btn.classList.toggle('liked', p.fav);
      break;
    }
    case 'delete':
      if (!confirm('このポストを削除しますか？')) return;
      await db.deletePost(id);
      article.remove();
      toast('削除しました');
      break;
    case 'edit':
      await editPost(id);
      break;
    case 'share':
      await sharePost(id);
      break;
  }
});

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
  const files = (p.photos || []).map((b, i) => new File([b], `photo${i + 1}.jpg`, { type: b.type || 'image/jpeg' }));
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
  setChrome(query ? '検索' : 'ホーム', 'home');
  const posts = (await db.allPosts()).sort((a, b) => b.createdAt - a.createdAt);
  if (!alive()) return;

  view.innerHTML = `
    ${query ? '' : composerHTML()}
    <div class="search"><input type="search" placeholder="キーワード・#タグ・場所で検索" value="${esc(query)}"></div>
    <div id="feed"></div>`;
  if (!query) bindComposer(view.querySelector('.composer'), { onPosted: router });

  const feed = $('#feed');
  const draw = (q) => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? posts.filter((p) => (p.text || '').toLowerCase().includes(needle) || (p.loc?.name || '').toLowerCase().includes(needle))
      : posts;
    let shown = 0;
    const more = () => {
      const chunk = list.slice(shown, shown + PAGE);
      shown += chunk.length;
      feed.querySelector('.more')?.remove();
      feed.insertAdjacentHTML('beforeend', chunk.map((p) => postHTML(p)).join(''));
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
  const [posts, health, all] = await Promise.all([db.postsByDay(day), db.getHealth(day), db.allPosts()]);
  if (!alive()) return;
  posts.sort((a, b) => a.createdAt - b.createdAt);
  const md = day.slice(5);
  const past = all.filter((p) => p.day.slice(5) === md && p.day < day).sort((a, b) => b.createdAt - a.createdAt);
  const located = posts.filter((p) => p.loc);
  const d = parseDay(day);

  view.innerHTML = `
    <div class="day-head">
      <a class="icon-btn" href="#/day/${addDays(day, -1)}" aria-label="前の日">${I.left}</a>
      <div class="date" role="button" tabindex="0">
        <div class="small">${d.getFullYear()}年</div>
        <div class="big">${d.getMonth() + 1}<b>/</b>${d.getDate()}</div>
        <div class="small">${weekday(day)}曜日${day === today ? '<span class="today-badge">今日</span>' : ''}</div>
        <input type="date" value="${day}" aria-label="日付を選ぶ">
      </div>
      <a class="icon-btn" href="#/day/${addDays(day, 1)}" aria-label="次の日">${I.right}</a>
    </div>

    <h2 class="section-title">💗 からだ</h2>
    ${healthHTML(health)}

    <h2 class="section-title">🐾 足あと</h2>
    ${located.length ? `
      <div id="daymap" class="map"></div>
      <ol class="places">${located.map((p, i) => `
        <li><span class="num">${i + 1}</span><span class="t">${fmtTime(p.createdAt)}</span><span class="n"><span data-loc-for="${p.id}"><span>${esc(p.loc.name || '（地名を取得できませんでした）')}</span></span></span></li>`).join('')}
      </ol>` : '<p class="section-sub">この日の足あとはまだありません。おでかけ先でチェックインすると、ここに地図ができます 🐾</p>'}

    <h2 class="section-title">📝 できごと</h2>
    ${composerHTML({ day })}
    <div class="diary">${posts.map((p) => postHTML(p, { diary: true })).join('') || '<p class="section-sub" style="padding-top:8px">まだ何も書かれていません ✏️</p>'}</div>

    ${past.length ? `<h2 class="section-title">🕰️ 過去の${d.getMonth() + 1}月${d.getDate()}日</h2>${past.map((p) => postHTML(p)).join('')}` : ''}
  `;

  const dateBox = view.querySelector('.day-head .date');
  const dateInput = dateBox.querySelector('input');
  dateBox.addEventListener('click', () => { try { dateInput.showPicker(); } catch { dateInput.focus(); } });
  dateInput.addEventListener('change', () => { if (isDayKey(dateInput.value)) location.hash = `#/day/${dateInput.value}`; });

  bindComposer(view.querySelector('.composer'), { day, onPosted: router });
  bindHealthButtons(view, day);
  if (located.length) drawDayMap($('#daymap'), located);
}

function healthHTML(h) {
  const fields = HEALTH_FIELDS.filter((f) => h?.[f.key] != null);
  if (!fields.length) {
    return `<div class="health-empty"><span>ヘルスケアのデータがありません</span>
      <span class="btn-row"><button class="btn small" data-h="import">取り込む</button><button class="btn small secondary" data-h="edit">手入力</button></span></div>`;
  }
  return `<div class="health-grid">${fields.map((f) => `
      <div class="health-tile"><div class="ico">${f.icon}</div><div class="label">${f.label}</div>
      <div class="value">${formatValue(f, h[f.key])}<span class="unit">${f.unit}</span></div></div>`).join('')}
    </div>
    <div class="btn-row" style="padding:0 12px 4px"><button class="btn small secondary" data-h="import">取り込む</button><button class="btn small secondary" data-h="edit">編集</button></div>`;
}

function bindHealthButtons(root, day) {
  root.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.h === 'import') importHealthFromClipboard();
    else editHealth(day);
  }));
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
          paint: { 'line-color': '#ff7aa8', 'line-width': 6, 'line-dasharray': [0, 2] },
        });
      },
    });
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* ================= ヘルスケア ================= */
async function importHealthFromClipboard() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { /* 許可されない環境 */ }
  if (text.trim()) {
    try { await importHealthText(text); return; } catch { /* 貼り付け画面へ */ }
  }
  pasteHealthDialog();
}

async function importHealthText(text) {
  const records = parseHealthText(text);
  for (const r of records) {
    const existing = (await db.getHealth(r.date)) || {};
    await db.putHealth({ ...existing, ...r, updatedAt: Date.now() });
  }
  toast(records.length === 1
    ? `${fmtDate(parseDay(records[0].date).getTime())}のヘルスケアを取り込みました`
    : `${records.length}日分のヘルスケアを取り込みました`);
  router();
}

async function pasteHealthDialog() {
  const r = await openDialog(`
    <form method="dialog">
      <div class="dlg-head">ヘルスケアを取り込む</div>
      <div class="dlg-body">
        <div class="field">
          <span class="help">ショートカットでコピーした内容を貼り付けてください。</span>
          <textarea name="json" class="mono" placeholder='{"date":"2026-11-06","steps":8123,"sleep":7.2}'></textarea>
        </div>
      </div>
      <div class="dlg-foot"><button class="btn secondary" value="cancel">キャンセル</button><button class="btn" value="ok">取り込む</button></div>
    </form>`);
  if (r !== 'ok') return;
  try { await importHealthText($('#dialog form').json.value); } catch (e) { toast(e.message); }
}

async function editHealth(day) {
  const h = (await db.getHealth(day)) || { date: day };
  const r = await openDialog(`
    <form method="dialog">
      <div class="dlg-head">${fmtDate(parseDay(day).getTime())}のからだ</div>
      <div class="dlg-body">
        ${HEALTH_FIELDS.map((f) => `
          <div class="field row"><label for="h-${f.key}">${f.label}<span class="help"> (${f.unit})</span></label>
          <input id="h-${f.key}" type="number" step="any" inputmode="decimal" name="${f.key}" value="${h[f.key] ?? ''}" style="max-width:140px;text-align:right"></div>`).join('')}
      </div>
      <div class="dlg-foot"><button class="btn secondary" value="cancel">キャンセル</button><button class="btn" value="ok">保存</button></div>
    </form>`);
  if (r !== 'ok') return;
  const f = $('#dialog form');
  const rec = { date: day, updatedAt: Date.now() };
  for (const field of HEALTH_FIELDS) {
    const v = f.elements[field.key].value.trim();
    if (v !== '' && Number.isFinite(Number(v))) rec[field.key] = Number(v);
  }
  await db.putHealth(rec);
  toast('保存しました');
  router();
}

/* ================= カレンダー ================= */
async function renderCalendar(ym, alive) {
  const thisMonth = dayKey().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) ym = thisMonth;
  setChrome('カレンダー', 'calendar', ym !== thisMonth ? '<a class="btn small secondary" href="#/calendar">今月</a>' : '');
  const [y, m] = ym.split('-').map(Number);
  const [posts, health] = await Promise.all([db.allPosts(), db.allHealth()]);
  if (!alive()) return;

  const byDay = new Map();
  for (const p of posts) {
    if (!p.day.startsWith(ym)) continue;
    const e = byDay.get(p.day) || { n: 0, loc: 0 };
    e.n++;
    if (p.loc) e.loc++;
    byDay.set(p.day, e);
  }
  const hMap = new Map(health.filter((h) => h.date.startsWith(ym)).map((h) => [h.date, h]));
  const steps = [...hMap.values()].map((h) => h.steps).filter((v) => v != null);
  const monthPosts = [...byDay.values()].reduce((s, e) => s + e.n, 0);

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
    const h = hMap.get(key);
    const dots = e ? Array.from({ length: Math.min(e.n, 6) }, (_, i) => `<i class="${i < e.loc ? 'loc' : ''}"></i>`).join('') : '';
    cells += `<a href="#/day/${key}" class="${e ? 'has' : ''} ${key === today ? 'today' : ''}">
      <span class="d">${dd}</span>
      ${h?.steps != null ? `<span class="steps">${Math.round(h.steps).toLocaleString()}歩</span>` : ''}
      <span class="dots">${dots}</span></a>`;
  }

  view.innerHTML = `
    <div class="cal-head">
      <a class="icon-btn" href="#/calendar/${prev}" aria-label="前の月">${I.left}</a>
      <span class="m">${y}年${m}月</span>
      <a class="icon-btn" href="#/calendar/${next}" aria-label="次の月">${I.right}</a>
    </div>
    <div class="cal">${[...'日月火水木金土'].map((w) => `<div class="wd">${w}</div>`).join('')}${cells}</div>
    <div class="health-grid">
      <div class="health-tile"><div class="label">ポスト</div><div class="value">${monthPosts}<span class="unit">件</span></div></div>
      <div class="health-tile"><div class="label">書いた日</div><div class="value">${byDay.size}<span class="unit">日</span></div></div>
      <div class="health-tile"><div class="label">平均歩数</div><div class="value">${steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length).toLocaleString() : '–'}<span class="unit">歩</span></div></div>
    </div>
    <div class="legend"><span><i></i>ポスト</span><span><i class="loc"></i>位置つき</span></div>`;
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
  view.innerHTML = '<div id="bigmap" class="map tall"></div>';
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
    <h2 class="section-title">🐣 プロフィール</h2>
    <div class="group">
    <div class="field"><span class="label">アイコン</span>
      <div class="avatar-pick">${AVATARS.map((a) => `<button type="button" data-av="${a}" class="${a === settings.avatar ? 'sel' : ''}">${a}</button>`).join('')}</div></div>
    <div class="field"><label for="s-name">表示名</label><input id="s-name" type="text" value="${esc(settings.name)}"></div>
    <div class="field"><label for="s-handle">ユーザー名</label><input id="s-handle" type="text" value="${esc(settings.handle)}"></div>
    </div>

    <h2 class="section-title">📍 位置情報</h2>
    <div class="group">
    <div class="field row"><div><div class="label">ポストに位置をつける</div><div class="help">新しいポストの位置ボタンを最初からONにします</div></div>
      <label class="switch"><input type="checkbox" id="s-autoloc" ${settings.autoLocation ? 'checked' : ''}><span></span></label></div>
    <div class="field row"><div><div class="label">地名を調べる</div><div class="help">座標を OpenStreetMap に送り、地名に変換します</div></div>
      <label class="switch"><input type="checkbox" id="s-geocode" ${settings.geocode ? 'checked' : ''}><span></span></label></div>
    </div>

    <h2 class="section-title">💗 ヘルスケア</h2>
    <div class="group">
    <div class="field">
      <div class="help">iPhone のショートカットで今日のヘルスケアをコピーしてから「クリップボードから取り込む」を押します。</div>
      <div class="btn-row">
        <button class="btn small" id="h-clip">クリップボードから取り込む</button>
        <button class="btn small secondary" id="h-paste">貼り付けて取り込む</button>
        <label class="btn small secondary">ファイルから<input type="file" id="h-file" accept=".json,.txt,application/json,text/plain" hidden></label>
      </div>
    </div>
    <details class="howto">
      <summary>ショートカットの作り方</summary>
      <ol>
        <li>「ショートカット」アプリで新規ショートカットを作成</li>
        <li><code>ヘルスケアサンプルを検索</code>（種類: 歩数 / 開始日: 今日）→ <code>統計を計算</code>（合計）</li>
        <li>同様に 距離・アクティブエネルギー・睡眠 などを取得</li>
        <li><code>辞書</code> を追加し、下のキー名で値を入れる（date は <code>日付を書式設定</code> で yyyy-MM-dd）</li>
        <li><code>クリップボードにコピー</code> で辞書をコピー</li>
        <li>（任意）オートメーションで毎晩 22:00 に「すぐに実行」</li>
      </ol>
      <pre>{
  "date": "2026-11-06",
  "steps": 8123,
  "distance": 5.4,
  "activeEnergy": 320,
  "exercise": 35,
  "sleep": 7.2,
  "restingHR": 58,
  "weight": 62.5
}</pre>
      <div class="help">配列で複数日分をまとめて渡すこともできます。詳しくは README を参照。</div>
    </details>
    </div>

    <h2 class="section-title">💾 バックアップ</h2>
    <div class="group"><div class="field">
      <div class="help">データはこの端末の中だけに保存されています。機種変更やもしもに備えて、ときどき書き出してください。${storage ? `<br>${storage}` : ''}</div>
      <div class="btn-row">
        <button class="btn small" id="b-export">書き出す</button>
        <label class="btn small secondary">読み込む<input type="file" id="b-import" accept=".json,application/json" hidden></label>
      </div>
    </div></div>

    <h2 class="section-title">🧹 その他</h2>
    <div class="group"><div class="field"><div class="btn-row"><button class="btn small danger" id="wipe">すべてのデータを削除</button></div></div></div>
    <p class="section-sub" style="padding-top:12px">Daylog v1.0</p>
  </div>`;

  const bindText = (id, key) => $(id).addEventListener('change', (e) => {
    settings[key] = e.target.value.trim() || DEFAULTS[key];
    saveSettings();
    toast('保存しました');
  });
  bindText('#s-name', 'name');
  bindText('#s-handle', 'handle');
  view.querySelector('.avatar-pick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-av]');
    if (!b) return;
    settings.avatar = b.dataset.av;
    saveSettings();
    view.querySelectorAll('[data-av]').forEach((x) => x.classList.toggle('sel', x === b));
    toast(`アイコンを ${b.dataset.av} にしました`);
  });
  $('#s-autoloc').addEventListener('change', (e) => {
    settings.autoLocation = e.target.checked;
    saveSettings();
    if (e.target.checked) getPosition().catch((err) => toast(err.message)); // 許可ダイアログを先に出す
  });
  $('#s-geocode').addEventListener('change', (e) => { settings.geocode = e.target.checked; saveSettings(); });

  $('#h-clip').addEventListener('click', importHealthFromClipboard);
  $('#h-paste').addEventListener('click', pasteHealthDialog);
  $('#h-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { await importHealthText(await file.text()); } catch (err) { toast(err.message); }
  });

  $('#b-export').addEventListener('click', exportBackup);
  $('#b-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importBackup(file);
  });
  $('#wipe').addEventListener('click', async () => {
    if (!confirm('すべてのポストとヘルスケアのデータを削除します。元に戻せません。よろしいですか？')) return;
    if (!confirm('本当に削除しますか？（先にバックアップを書き出すことをおすすめします）')) return;
    await db.clearAll();
    toast('すべて削除しました');
    location.hash = '#/';
  });
}

async function exportBackup() {
  toast('書き出し中…');
  const [posts, health] = await Promise.all([db.allPosts(), db.allHealth()]);
  const out = {
    app: 'daylog',
    version: 1,
    exportedAt: new Date().toISOString(),
    posts: await Promise.all(posts.map(async (p) => ({ ...p, photos: await Promise.all((p.photos || []).map(blobToDataURL)) }))),
    health,
  };
  const name = `daylog-backup-${dayKey()}.json`;
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'daylog') throw new Error('Daylog のバックアップではありません');
    for (const p of data.posts || []) {
      await db.putPost({ ...p, photos: await Promise.all((p.photos || []).map(dataURLToBlob)) });
    }
    for (const h of data.health || []) await db.putHealth(h);
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
router();

navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
