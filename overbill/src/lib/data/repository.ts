import type { AppState } from "../types";
import { createSeedState } from "./seed";

/**
 * Persistence boundary. The UI only talks to the store, and the store only talks to a Repository.
 * Swap `localRepository` for an API/DB-backed implementation without touching any component.
 */
export interface Repository {
  load(): AppState | null;
  save(state: AppState): void;
  clear(): void;
}

const KEY = "overbill:v1";

export const localRepository: Repository = {
  load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AppState;
      return parsed?.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  },
  save(state) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full or unavailable: keep working in memory */
    }
  },
  clear() {
    try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};

export const getInitialState = (): AppState => createSeedState();
