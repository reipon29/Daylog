// Service Worker: アプリ本体をキャッシュしてオフラインでも起動できるようにする。
// ・アプリのファイルは「ネット優先」：つながっていれば常に最新、圏外のときだけ保存した版
// ・外部ライブラリ（中身が変わらない）は保存した版を優先
// ファイルを更新したら VERSION を上げる。
const VERSION = 'daylog-v14';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/util.js',
  './js/location.js',
  './js/exif.js',
  './js/weather.js',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const CDN = ['https://cdnjs.cloudflare.com/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

self.addEventListener('install', (e) => {
  // ブラウザの HTTP キャッシュを通さず、必ず最新を取りにいく
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ネット優先（3秒待っても返ってこなければ保存した版）
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    // ページを開くリクエストはオプションを付けて作り直せないので、URL で取り直す
    const fresh = req.mode === 'navigate'
      ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      : fetch(req, { cache: 'no-cache' });
    const res = await Promise.race([
      fresh,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === 'navigate') return cache.match('./index.html');
    throw new Error('offline');
  }
}

// 保存した版を即返し、裏で更新
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' || url.origin === self.location.origin) {
    e.respondWith(networkFirst(request));
  } else if (CDN.some((c) => url.href.startsWith(c))) {
    e.respondWith(staleWhileRevalidate(request));
  }
  // 地図タイル・地名検索・天気はネットワークのみ
});
