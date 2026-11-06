// IndexedDB の薄いラッパー。データはすべて端末内に保存される。
//
// v1: posts（写真の Blob をポストの中に保存）/ health
// v2: 写真を photos ストアに分離し、ポストには写真の ID だけを持たせる。
//     → 一覧表示で写真を全部読み込まずに済むので、写真が増えても軽い。
import { uid } from './util.js';

const DB_NAME = 'daylog';
const DB_VERSION = 2;

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const tx = req.transaction;
      if (!db.objectStoreNames.contains('posts')) {
        const posts = db.createObjectStore('posts', { keyPath: 'id' });
        posts.createIndex('createdAt', 'createdAt');
        posts.createIndex('day', 'day');
      }
      if (!db.objectStoreNames.contains('health')) {
        db.createObjectStore('health', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
      // v1 → v2：ポスト内の写真を photos ストアへ移す
      if (e.oldVersion >= 1 && e.oldVersion < 2) {
        const photos = tx.objectStore('photos');
        tx.objectStore('posts').openCursor().onsuccess = (ev) => {
          const cur = ev.target.result;
          if (!cur) return;
          const p = cur.value;
          if (p.photos?.some((x) => x instanceof Blob)) {
            p.photos = p.photos.map((x) => {
              if (!(x instanceof Blob)) return x;
              const id = uid();
              photos.put({ id, blob: x });
              return id;
            });
            cur.update(p);
          }
          cur.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  putPost: (post) => run('posts', 'readwrite', (s) => s.put(post)),
  getPost: (id) => run('posts', 'readonly', (s) => s.get(id)),
  allPosts: () => run('posts', 'readonly', (s) => s.getAll()),
  postsByDay: (day) => run('posts', 'readonly', (s) => s.index('day').getAll(day)),
  async deletePost(id) {
    const p = await db.getPost(id);
    await run('posts', 'readwrite', (s) => s.delete(id));
    for (const pid of p?.photos || []) await db.deletePhoto(pid);
  },

  // 写真
  async addPhoto(blob) {
    const id = uid();
    await run('photos', 'readwrite', (s) => s.put({ id, blob }));
    return id;
  },
  getPhoto: async (id) => (await run('photos', 'readonly', (s) => s.get(id)))?.blob || null,
  deletePhoto: (id) => run('photos', 'readwrite', (s) => s.delete(id)),

  putHealth: (h) => run('health', 'readwrite', (s) => s.put(h)),
  getHealth: (date) => run('health', 'readonly', (s) => s.get(date)),
  allHealth: () => run('health', 'readonly', (s) => s.getAll()),

  async clearAll() {
    await run('posts', 'readwrite', (s) => s.clear());
    await run('photos', 'readwrite', (s) => s.clear());
    await run('health', 'readwrite', (s) => s.clear());
  },
};
