"use client";
import { useMemo } from "react";
import { auditAll, vendorStats, type Audits } from "./selectors";
import { useAppState } from "./store";
import type { AppState } from "../types";

// Several mounted UI areas can ask for the same audits at once (the desktop and mobile notification bell, for example).
// Share the immutable result by state reference so those views do not repeat a full audit on every render.
let auditedState: AppState | null = null;
let cachedAudits: Audits | null = null;
function auditsFor(state: AppState): Audits {
  if (state !== auditedState || cachedAudits === null) {
    auditedState = state;
    cachedAudits = auditAll(state);
  }
  return cachedAudits;
}

export function useAudited() {
  const state = useAppState();
  const audits = useMemo(() => auditsFor(state), [state]);
  return { state, audits };
}

export function useVendorStats() {
  const { state, audits } = useAudited();
  const stats = useMemo(() => vendorStats(state, audits), [state, audits]);
  return { state, audits, stats };
}
