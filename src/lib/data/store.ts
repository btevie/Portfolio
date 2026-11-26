"use client";
import { useSyncExternalStore } from "react";
import type {
  AppState, ContractRate, FindingDecision, Invoice, RecoveryRecord, RecoveryStatus, UserSettings, Vendor,
} from "../types";
import { localRepository, type Repository } from "./repository";
import { createSeedState } from "./seed";

const SERVER_STATE: AppState = createSeedState();
let repo: Repository = localRepository;
let state: AppState | null = null;
const listeners = new Set<() => void>();

function current(): AppState {
  if (state === null) state = repo.load() ?? createSeedState();
  return state;
}

function commit(next: AppState) {
  state = next;
  repo.save(next);
  listeners.forEach((l) => l());
}

const update = (fn: (s: AppState) => AppState) => commit(fn(current()));
const today = () => new Date().toISOString().slice(0, 10);
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

if (typeof window !== "undefined") {
  // Another tab wrote new data: adopt it instead of overwriting it with a stale copy on the next save.
  window.addEventListener("storage", (e) => {
    if (e.key === "overbill:v1") { state = null; listeners.forEach((l) => l()); }
  });
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    current,
    () => SERVER_STATE,
  );
}

/** Test/ops hook: replace the persistence backend. */
export function setRepository(r: Repository) { repo = r; state = null; }

export const actions = {
  addInvoices(invoices: Invoice[], newVendors: Vendor[] = []) {
    update((s) => ({
      ...s,
      vendors: [...s.vendors, ...newVendors.filter((v) => !s.vendors.some((x) => x.id === v.id))],
      invoices: [...s.invoices, ...invoices],
    }));
  },
  deleteInvoice(id: string) {
    update((s) => ({ ...s, invoices: s.invoices.filter((i) => i.id !== id) }));
  },
  setDecision(findingId: string, decision: FindingDecision) {
    update((s) => ({ ...s, decisions: { ...s.decisions, [findingId]: decision } }));
  },
  addRecovery(r: Omit<RecoveryRecord, "id" | "createdAt" | "updatedAt" | "status"> & { status?: RecoveryStatus }) {
    const rec: RecoveryRecord = { ...r, status: r.status ?? "flagged", id: uid("rec"), createdAt: today(), updatedAt: today() };
    update((s) => ({ ...s, recovery: [rec, ...s.recovery] }));
    return rec;
  },
  updateRecovery(id: string, patch: Partial<Pick<RecoveryRecord, "status" | "notes" | "amount">>) {
    update((s) => ({
      ...s,
      recovery: s.recovery.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: today() } : r)),
    }));
  },
  updateVendor(id: string, patch: Partial<Vendor>) {
    update((s) => ({ ...s, vendors: s.vendors.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  },
  addContractRate(rate: Omit<ContractRate, "id">) {
    update((s) => ({ ...s, contractRates: [...s.contractRates, { ...rate, id: uid("cr") }] }));
  },
  removeContractRate(id: string) {
    update((s) => ({ ...s, contractRates: s.contractRates.filter((r) => r.id !== id) }));
  },
  updateSettings(patch: Partial<UserSettings>) {
    update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  },
  updateUser(patch: Partial<AppState["user"]>) {
    update((s) => ({ ...s, user: { ...s.user, ...patch } }));
  },
  /** Restore the labelled demo dataset (settings are kept). */
  resetDemo() {
    const seed = createSeedState();
    update((s) => ({ ...seed, settings: s.settings, user: s.user }));
  },
  /** Remove every invoice, vendor and record. */
  clearAll() {
    update((s) => ({ ...s, vendors: [], invoices: [], contractRates: [], recovery: [], decisions: {} }));
  },
};

/** Non-reactive read for event handlers. */
export function getSnapshotState(): AppState { return current(); }
