// Persistencia en IndexedDB: carpeta recordada (handle), caché de metadatos de
// la biblioteca y carátulas deduplicadas. Nunca se guardan archivos de audio.

const DB_NAME = 'folderplay';
const LEGACY_DB_NAME = 'miusic'; // nombre anterior de la app
const VERSION = 2;
const MIGRATED_KEY = '__migrated';

let dbPromise = null;

function openDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Una sola conexión para toda la sesión; la migración se intenta una vez.
function db() {
  if (!dbPromise) {
    dbPromise = openDb(DB_NAME).then(async (conn) => {
      try {
        await migrateLegacyDb(conn);
      } catch { /* sin datos antiguos que recuperar */ }
      return conn;
    });
  }
  return dbPromise;
}

const reqDone = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

// Copia la base del nombre anterior (Miusic) para conservar carpeta y caché.
async function migrateLegacyDb(conn) {
  const done = await reqDone(conn.transaction('kv', 'readonly').objectStore('kv').get(MIGRATED_KEY));
  if (done) return;
  // Se marca antes de copiar: si algo falla no se reintenta en cada arranque.
  const mark = conn.transaction('kv', 'readwrite');
  mark.objectStore('kv').put(1, MIGRATED_KEY);
  await txDone(mark);

  const existing = await indexedDB.databases?.();
  if (!existing?.some((d) => d.name === LEGACY_DB_NAME)) return;

  const legacy = await openDb(LEGACY_DB_NAME);
  try {
    const readTx = legacy.transaction(['kv', 'covers'], 'readonly');
    const [kvKeys, kvValues, coverKeys, coverValues] = await Promise.all([
      reqDone(readTx.objectStore('kv').getAllKeys()),
      reqDone(readTx.objectStore('kv').getAll()),
      reqDone(readTx.objectStore('covers').getAllKeys()),
      reqDone(readTx.objectStore('covers').getAll()),
    ]);
    const writeTx = conn.transaction(['kv', 'covers'], 'readwrite');
    kvKeys.forEach((key, i) => {
      if (key !== MIGRATED_KEY) writeTx.objectStore('kv').put(kvValues[i], key);
    });
    coverKeys.forEach((key, i) => writeTx.objectStore('covers').put(coverValues[i], key));
    await txDone(writeTx);
  } finally {
    legacy.close();
  }
  indexedDB.deleteDatabase(LEGACY_DB_NAME);
}

export async function kvGet(key) {
  const conn = await db();
  return reqDone(conn.transaction('kv', 'readonly').objectStore('kv').get(key));
}

export async function kvSet(key, value) {
  const conn = await db();
  const tx = conn.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  return txDone(tx);
}

// Clave estable de una carátula por contenido (tamaño + hash de cabecera):
// permite guardar una sola imagen por álbum aunque venga repetida en cada pista.
export async function coverKeyOf(blob) {
  const head = new Uint8Array(await blob.slice(0, 256).arrayBuffer());
  let h = 7;
  for (const b of head) h = (h * 31 + b) >>> 0;
  return `${blob.size}-${h.toString(36)}`;
}

export async function loadCovers(keys) {
  const conn = await db();
  const out = new Map();
  const tx = conn.transaction('covers', 'readonly');
  const store = tx.objectStore('covers');
  for (const key of keys) {
    const req = store.get(key);
    req.onsuccess = () => {
      if (req.result) out.set(key, req.result);
    };
  }
  await txDone(tx);
  return out;
}

// Sincroniza el store de carátulas con las referenciadas: sube las nuevas
// y elimina las huérfanas (canciones borradas o portadas cambiadas).
export async function syncCovers(referenced) {
  const conn = await db();
  const tx = conn.transaction('covers', 'readwrite');
  const store = tx.objectStore('covers');
  const existing = new Set(await reqDone(store.getAllKeys()));
  for (const key of existing) {
    if (!referenced.has(key)) store.delete(key);
  }
  for (const [key, blob] of referenced) {
    if (!existing.has(key)) store.put(blob, key);
  }
  return txDone(tx);
}

// Olvida la carpeta: handle, caché de biblioteca y carátulas.
export async function clearFolderData() {
  const conn = await db();
  const tx = conn.transaction(['kv', 'covers'], 'readwrite');
  tx.objectStore('kv').delete('dirHandle');
  tx.objectStore('kv').delete('library');
  tx.objectStore('covers').clear();
  return txDone(tx);
}
