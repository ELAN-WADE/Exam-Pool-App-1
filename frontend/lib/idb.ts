const DB_NAME = "exampool-offline-db";
const DB_VERSION = 1;
const PKG_STORE = "epkg-bundles";
const SUBMIT_STORE = "offline-submissions";

/**
 * Module-level singleton promise.
 * The IDB connection is opened once and reused for all operations.
 * This avoids the overhead of repeatedly opening/closing IDB across
 * rapid calls (e.g., auto-save during exam → answer map operations).
 */
let _dbPromise: Promise<IDBDatabase> | null = null;

export function initDB(): Promise<IDBDatabase> {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(PKG_STORE)) {
          db.createObjectStore(PKG_STORE); // key is packageId
        }
        if (!db.objectStoreNames.contains(SUBMIT_STORE)) {
          db.createObjectStore(SUBMIT_STORE, { autoIncrement: true });
        }
      };
      request.onsuccess = (event: any) => resolve(event.target.result);
      request.onerror = (event: any) => {
        _dbPromise = null; // allow retry on next call if it failed
        reject(event.target.error);
      };
    });
  }
  return _dbPromise;
}

export async function savePackage(packageId: string, data: any): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PKG_STORE, "readwrite");
    const store = tx.objectStore(PKG_STORE);
    const req = store.put(data, packageId);
    req.onsuccess = () => resolve();
    req.onerror = (e: any) => reject(e.target.error);
  });
}

export async function getPackage(packageId: string): Promise<any> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PKG_STORE, "readonly");
    const store = tx.objectStore(PKG_STORE);
    const req = store.get(packageId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e: any) => reject(e.target.error);
  });
}

export async function deletePackage(packageId: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PKG_STORE, "readwrite");
    const store = tx.objectStore(PKG_STORE);
    const req = store.delete(packageId);
    req.onsuccess = () => resolve();
    req.onerror = (e: any) => reject(e.target.error);
  });
}

export async function getAllPackageIds(): Promise<string[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PKG_STORE, "readonly");
    const store = tx.objectStore(PKG_STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = (e: any) => reject(e.target.error);
  });
}

export async function saveOfflineSubmission(submission: any): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SUBMIT_STORE, "readwrite");
    const store = tx.objectStore(SUBMIT_STORE);
    const req = store.put(submission);
    req.onsuccess = () => resolve();
    req.onerror = (e: any) => reject(e.target.error);
  });
}

export async function getOfflineSubmissions(): Promise<{key: IDBValidKey, value: any}[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SUBMIT_STORE, "readonly");
    const store = tx.objectStore(SUBMIT_STORE);
    const request = store.openCursor();
    const results: {key: IDBValidKey, value: any}[] = [];
    request.onsuccess = (event: any) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push({ key: cursor.key, value: cursor.value });
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = (e: any) => reject(e.target.error);
  });
}

export async function deleteOfflineSubmission(key: IDBValidKey): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SUBMIT_STORE, "readwrite");
    const store = tx.objectStore(SUBMIT_STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = (e: any) => reject(e.target.error);
  });
}
