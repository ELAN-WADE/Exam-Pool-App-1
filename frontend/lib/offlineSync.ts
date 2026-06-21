// frontend/lib/offlineSync.ts
export interface OfflineAssignment {
  id: number;
  name: string;
  code: string;
  term: string;
  duration: number;
  questions: any[];
  synced_at: number;
}

export interface OfflineSubmission {
  subject_id: number;
  start_time: string;
  end_time: string;
  score: number;
  total_score: number;
  answers: any[];
}

export interface OfflineFileUpload {
  id: string; // unique string id
  file: File;
  question_id: number;
}

const DB_NAME = "ExampoolOfflineDB";
const DB_VERSION = 1;

export async function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("assignments")) {
        db.createObjectStore("assignments", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("submissions")) {
        db.createObjectStore("submissions", { keyPath: "subject_id" });
      }
      if (!db.objectStoreNames.contains("uploads")) {
        db.createObjectStore("uploads", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Assignments Cache ────────────────────────────────────────────────────────
export async function cacheAssignments(assignments: OfflineAssignment[]) {
  const db = await openOfflineDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("assignments", "readwrite");
    const store = tx.objectStore("assignments");
    store.clear();
    for (const a of assignments) {
      store.put({ ...a, synced_at: Date.now() });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedAssignments(): Promise<OfflineAssignment[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("assignments", "readonly");
    const req = tx.objectStore("assignments").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ── Submissions Queue ────────────────────────────────────────────────────────
export async function saveOfflineSubmission(submission: OfflineSubmission) {
  const db = await openOfflineDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("submissions", "readwrite");
    tx.objectStore("submissions").put(submission);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingSubmissions(): Promise<OfflineSubmission[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("submissions", "readonly");
    const req = tx.objectStore("submissions").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearPendingSubmissions() {
  const db = await openOfflineDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("submissions", "readwrite");
    tx.objectStore("submissions").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Uploads Queue ────────────────────────────────────────────────────────────
export async function queueFileUpload(file: File, question_id: number): Promise<string> {
  const db = await openOfflineDB();
  const id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("uploads", "readwrite");
    tx.objectStore("uploads").put({ id, file, question_id });
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingUploads(): Promise<OfflineFileUpload[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("uploads", "readonly");
    const req = tx.objectStore("uploads").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearPendingUploads() {
  const db = await openOfflineDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("uploads", "readwrite");
    tx.objectStore("uploads").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
