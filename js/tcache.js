/* Cache hasil terjemahan per file di IndexedDB (kapasitas jauh di atas localStorage,
 * bisa menyimpan byte hasil + segmen).
 * Masa berlaku 24 jam: entri basi dihapus dan tidak dipakai lagi.
 * Dipakai agar refresh halaman tidak menghanguskan hasil terjemahan
 * (hemat kuota API — tidak perlu menerjemahkan ulang).
 */
export const TCACHE_TTL = 24 * 3600 * 1000; // 24 jam
const DB_NAME = "vntranslate";
const STORE = "filecache";
const DB_VER = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "path" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("gagal buka IndexedDB"));
    } catch (e) {
      reject(e);
    }
  });
}
let dbp = null;
function db() {
  if (!dbp) dbp = openDb();
  return dbp;
}

export async function tcacheGet(path) {
  const d = await db();
  return new Promise((resolve, reject) => {
    try {
      const rq = d.transaction(STORE, "readonly").objectStore(STORE).get(path);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    } catch (e) { reject(e); }
  });
}

export async function tcachePut(entry) {
  const d = await db();
  return new Promise((resolve, reject) => {
    try {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

export async function tcacheDel(path) {
  const d = await db();
  return new Promise((resolve, reject) => {
    try {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

/* Hapus semua entri basi. Dijalankan sekali saat aplikasi start (fire-and-forget). */
export async function tcacheCleanup() {
  const d = await db();
  const now = Date.now();
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const cur = store.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) { resolve(); return; }
        if (now - (c.value.savedAt || 0) > TCACHE_TTL) c.delete();
        c.continue();
      };
      cur.onerror = () => resolve();
    } catch { resolve(); }
  });
}
