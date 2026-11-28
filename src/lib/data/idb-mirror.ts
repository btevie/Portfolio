/**
 * A second copy of the app's data in IndexedDB. localStorage holds about 5 MB and some browsers clear it when space is
 * tight; IndexedDB holds far more and is asked to be persistent. The mirror is only read to offer a restore when
 * localStorage has lost the data, so it can never overwrite newer data by itself.
 */
const DB = "overbill";
const STORE = "mirror";
const KEY = "state";
const REV_KEY = "state-revision";

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
      const t = db.transaction(STORE, mode);
      const r = run(t.objectStore(STORE));
      let result: T;
      r.onsuccess = () => { result = r.result; };
      r.onerror = () => reject(r.error);
      // Only report success once the transaction has committed: a request can succeed and the transaction still abort.
      t.oncomplete = () => resolve(result);
      t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally { db.close(); }
}

export const mirrorSupported = () => typeof indexedDB !== "undefined";

let timer: ReturnType<typeof setTimeout> | null = null;
let askedPersist = false;

/** Debounced so a burst of edits writes once. Failures are ignored: the mirror is a safety net, not the source of truth. */
let revision = 0;
const stamp = () => `${Date.now().toString(36).padStart(10, "0")}-${(revision++).toString(36)}`;

export function mirrorSave(json: string): void {
  if (!mirrorSupported()) return;
  if (timer) clearTimeout(timer);
  const mine = stamp(); // taken now, when the snapshot was made, so a tab that wakes late cannot give an older snapshot a newer stamp
  timer = setTimeout(() => {
    timer = null;
    writeNewest(json, mine).catch(() => { /* best effort */ });
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
  // Delete the snapshot and advance the revision in one transaction. A save that another tab queued before this moment carries an
  // older stamp, so writeNewest rejects it; a genuinely newer save still wins.
  const deletedAt = stamp();
  try {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, "readwrite");
        const store = t.objectStore(STORE);
        const get = store.get(REV_KEY);
        get.onsuccess = () => {
          const current = get.result as string | undefined;
          if (current && current > deletedAt) return; // a newer snapshot was saved after this clear was requested: keep it
          store.delete(KEY); store.put(deletedAt, REV_KEY);
        };
        t.oncomplete = () => resolve();
        t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
      });
    } finally { db.close(); }
  } catch { /* nothing to clear */ }
}

/** Writes only if this snapshot is newer than the stored one, decided inside the write transaction. An older tab waking late cannot replace newer data. */
async function writeNewest(json: string, mine: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      const store = t.objectStore(STORE);
      const get = store.get(REV_KEY);
      get.onsuccess = () => {
        const current = get.result as string | undefined;
        if (current && current > mine) return; // a newer snapshot is already stored
        store.put(json, KEY); store.put(mine, REV_KEY);
      };
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally { db.close(); }
}
