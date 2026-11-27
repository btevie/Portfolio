/**
 * A second copy of the app's data in IndexedDB. localStorage holds about 5 MB and some browsers clear it when space is
 * tight; IndexedDB holds far more and is asked to be persistent. The mirror is only read to offer a restore when
 * localStorage has lost the data, so it can never overwrite newer data by itself.
 */
const DB = "overbill";
const STORE = "mirror";
const KEY = "state";

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = run(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally { db.close(); }
}

export const mirrorSupported = () => typeof indexedDB !== "undefined";

let timer: ReturnType<typeof setTimeout> | null = null;
let askedPersist = false;

/** Debounced so a burst of edits writes once. Failures are ignored: the mirror is a safety net, not the source of truth. */
export function mirrorSave(json: string): void {
  if (!mirrorSupported()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    tx("readwrite", (s) => s.put(json, KEY)).catch(() => { /* best effort */ });
    if (!askedPersist) { askedPersist = true; navigator.storage?.persist?.().catch(() => { /* best effort */ }); }
  }, 600);
}

export async function mirrorLoad(): Promise<string | null> {
  if (!mirrorSupported()) return null;
  try { return ((await tx("readonly", (s) => s.get(KEY))) as string | undefined) ?? null; } catch { return null; }
}

export async function mirrorClear(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; } // a pending write must not bring back what was just deleted
  if (!mirrorSupported()) return;
  try { await tx("readwrite", (s) => s.delete(KEY)); } catch { /* nothing to clear */ }
}
