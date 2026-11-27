"use client";
import { useSyncExternalStore } from "react";

const KEY = "overbill:last-backup";
const EVENT = "overbill:backup";

/** Remember when the person last downloaded a backup. Only the date is stored, never any invoice data. */
export function markBackedUp() {
  try { localStorage.setItem(KEY, String(Date.now())); window.dispatchEvent(new Event(EVENT)); } catch { /* storage unavailable: nothing to remember */ }
}

const subscribe = (cb: () => void) => { window.addEventListener(EVENT, cb); window.addEventListener("storage", cb); return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); }; };
const read = () => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };

/** Whole days since the last backup, -1 if there never was one. Computed in the snapshot so render stays pure. */
const ageDays = () => { const raw = read(); const t = Number(raw); return raw && Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : -1; };

/** Days since the last backup, `null` if there never was one, `undefined` before the browser has been read. */
export function useBackupAge(): number | null | undefined {
  const days = useSyncExternalStore(subscribe, ageDays, () => undefined);
  return days === undefined ? undefined : days < 0 ? null : days;
}
