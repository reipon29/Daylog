export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const pad = (n) => String(n).padStart(2, '0');
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// 端末のローカル日付で YYYY-MM-DD
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (key, n) => {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
export const isDayKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

const WD = '日月火水木金土';
export const weekday = (key) => WD[parseDay(key).getDay()];
export const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtDate = (ts) => {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${sameYear ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日`;
};
export const fmtRelative = (ts) => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分`;
  if (s < 86400 && dayKey(new Date(ts)) === dayKey()) return `${Math.floor(s / 3600)}時間`;
  return fmtDate(ts);
};

// URL と #ハッシュタグをリンク化（エスケープ済みHTMLを返す）
export function linkify(text) {
  return esc(text)
    .replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`)
    .replace(/(^|[\s　])[#＃]([^\s　#＃<>.,!?、。！？]+)/g,
      (_, pre, tag) => `${pre}<a class="tag" href="#/search/${encodeURIComponent(tag)}">#${tag}</a>`);
}

export function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

// 写真を長辺 max px の JPEG に縮小（容量節約）
export async function resizeImage(file, max = 1600, quality = 0.82) {
  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width, h = source.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
}

export const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});
export const dataURLToBlob = async (url) => (await fetch(url)).blob();

let mapLibPromise;
// 地図ライブラリ（MapLibre GL：ベクター地図なので高解像度画面でもくっきり）は必要になったときだけ読み込む
export function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibPromise) return mapLibPromise;
  mapLibPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js';
    s.onload = () => resolve(window.maplibregl);
    s.onerror = () => { mapLibPromise = null; reject(new Error('地図を読み込めませんでした')); };
    document.head.appendChild(s);
  });
  return mapLibPromise;
}
