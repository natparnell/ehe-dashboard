// Persistent JSON cache for /processed/** keyed against metadata.generated_at.
//
// Pattern (ported from the NEETS dashboard):
//   1. dataService asks idbGet(path).
//   2. If the entry's version matches metadata.generated_at, the cached blob is
//      returned and the network is skipped.
//   3. Otherwise the network fetch happens and the result is written back via
//      idbSet(path, version, data).
//
// Old entries from a prior preprocess are cleaned out on app boot via
// idbPurgeOtherVersions, so storage does not grow without bound across deploys.

const DB_NAME = 'ehe-cache'
const STORE_NAME = 'processed'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'))
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'path' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
  // If the underlying DB connection errors later (rare), drop the promise so a
  // future caller can retry. Until then, every caller shares the one handle.
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

export interface CacheEntry<T> {
  version: string
  data: T
}

export async function idbGet<T>(path: string): Promise<CacheEntry<T> | null> {
  try {
    const db = await openDB()
    return await new Promise<CacheEntry<T> | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(path)
      req.onsuccess = () => {
        const v = req.result as { version: string; data: T } | undefined
        if (!v) return resolve(null)
        resolve({ version: v.version, data: v.data })
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function idbSet(path: string, version: string, data: unknown): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put({ path, version, data, savedAt: Date.now() })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('aborted'))
    })
  } catch {
    // Quota exceeded, private browsing, etc. Silent skip; the in-memory Map
    // cache still works for the rest of the session.
  }
}

export async function idbPurgeOtherVersions(currentVersion: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        if (cursor.value.version !== currentVersion) cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('aborted'))
    })
  } catch {
    /* ignore */
  }
}
