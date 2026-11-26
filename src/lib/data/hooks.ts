"use client";
import { useMemo } from "react";
import { auditAll, vendorStats } from "./selectors";
import { useAppState } from "./store";

export function useAudited() {
  const state = useAppState();
  const audits = useMemo(() => auditAll(state), [state]);
  return { state, audits };
}

export function useVendorStats() {
  const { state, audits } = useAudited();
  const stats = useMemo(() => vendorStats(state, audits), [state, audits]);
  return { state, audits, stats };
}
