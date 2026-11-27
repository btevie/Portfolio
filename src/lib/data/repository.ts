import type { AppState } from "../types";
import { createSeedState } from "./seed";
import { mirrorClear, mirrorSave } from "./idb-mirror";
import { parseStoredState } from "./validate-state";

/**
 * Persistence boundary. The UI only talks to the store, and the store only talks to a Repository.
 * Swap `localRepository` for an API/DB-backed implementation without touching any component.
 */
export interface Repository {
  /** Returns validated state plus how many invalid stored records were skipped, or null if nothing usable is stored. */
  load(): { state: AppState; dropped: number } | null;
  /** Returns false when the state could not be persisted (storage full or blocked). */
  save(state: AppState): boolean;
  clear(): void;
}

const KEY = "overbill:v1";

export const localRepository: Repository = {
  load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      return parseStoredState(raw);
    } catch {
      return null;
    }
  },
  save(state) {
    const json = JSON.stringify(state);
    mirrorSave(json); // second copy in IndexedDB, written even when localStorage is full
    try {
      window.localStorage.setItem(KEY, json);
      return true;
    } catch {
      return false; // storage full or blocked: the store surfaces this to the user
    }
  },
  clear() {
    try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
    void mirrorClear();
  },
};

export const getInitialState = (): AppState => createSeedState();
