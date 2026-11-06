// IndexedDB の薄いラッパー。データはすべて端末内に保存される。
const DB_NAME = 'daylog';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('posts')) {
        const posts = db.createObjectStore('posts', { keyPath: 'id' });
        posts.createIndex('createdAt', 'createdAt');
        posts.createIndex('day', 'day');
      }
      if (!db.objectStoreNames.contains('health')) {
        db.createObjectStore('health', { keyPath: 'date' });
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
  deletePost: (id) => run('posts', 'readwrite', (s) => s.delete(id)),
  allPosts: () => run('posts', 'readonly', (s) => s.getAll()),
  postsByDay: (day) => run('posts', 'readonly', (s) => s.index('day').getAll(day)),

  putHealth: (h) => run('health', 'readwrite', (s) => s.put(h)),
  getHealth: (date) => run('health', 'readonly', (s) => s.get(date)),
  allHealth: () => run('health', 'readonly', (s) => s.getAll()),

  async clearAll() {
    await run('posts', 'readwrite', (s) => s.clear());
    await run('health', 'readwrite', (s) => s.clear());
  },
};
