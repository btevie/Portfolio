"use client";
import { useSyncExternalStore } from "react";
import type {
  AppState, ContractRate, FindingDecision, Invoice, RecoveryRecord, RecoveryStatus, UserSettings, Vendor,
} from "../types";
import { newId } from "../ids";
import { celebrate } from "../celebrate";
import { formatMoney } from "../audit/money";
import { localRepository, type Repository } from "./repository";
import { parseStoredState } from "./validate-state";
import { createSeedState, recovery as seedRecovery } from "./seed";

const SERVER_STATE: AppState = createSeedState();
let repo: Repository = localRepository;
let state: AppState | null = null;
const listeners = new Set<() => void>();

/** Persistence health, shown to the user so a failed save is never silent. */
export interface PersistStatus { saveFailed: boolean; dropped: number }
const OK_STATUS: PersistStatus = { saveFailed: false, dropped: 0 };
let status: PersistStatus = OK_STATUS;
const statusListeners = new Set<() => void>();
function setStatus(next: PersistStatus) {
  if (next.saveFailed === status.saveFailed && next.dropped === status.dropped) return;
  status = next;
  statusListeners.forEach((l) => l());
}

function current(): AppState {
  if (state === null) {
    const loaded = repo.load();
    state = loaded?.state ?? createSeedState();
    status = { ...status, dropped: loaded?.dropped ?? 0 }; // no notify: read during render
  }
  return state;
}

function commit(next: AppState) {
  state = next;
  setStatus({ ...status, saveFailed: !repo.save(next) });
  listeners.forEach((l) => l());
}

export function usePersistStatus(): PersistStatus {
  return useSyncExternalStore(
    (l) => { statusListeners.add(l); return () => statusListeners.delete(l); },
    () => { current(); return status; },
    () => OK_STATUS,
  );
}

const update = (fn: (s: AppState) => AppState) => commit(fn(current()));
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const uid = (p: string) => `${p}-${newId().slice(0, 8)}`;

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
    update((s) => {
      const decisions = Object.fromEntries(Object.entries(s.decisions).filter(([findingId]) => !findingId.startsWith(`${id}:`)));
      const recovery = s.recovery.map((r) => r.invoiceId === id ? { ...r, invoiceId: undefined, findingId: undefined } : r);
      return { ...s, invoices: s.invoices.filter((i) => i.id !== id), decisions, recovery };
    });
  },
  /** The user's own record of whether they paid. "overdue" is derived from the due date, never stored by hand. */
  setPaymentStatus(id: string, paymentStatus: "paid" | "unpaid") {
    update((s) => ({ ...s, invoices: s.invoices.map((i) => (i.id === id ? { ...i, paymentStatus } : i)) }));
  },
  setDecision(findingId: string, decision: FindingDecision) {
    update((s) => ({ ...s, decisions: { ...s.decisions, [findingId]: decision } }));
  },
  setInvoicePaymentStatus(id: string, paymentStatus: "paid" | "unpaid") {
    update((s) => ({ ...s, invoices: s.invoices.map((i) => i.id === id ? { ...i, paymentStatus } : i) }));
  },
  addRecovery(r: Omit<RecoveryRecord, "id" | "createdAt" | "updatedAt" | "status"> & { status?: RecoveryStatus }) {
    if (r.findingId) {
      const existing = current().recovery.find((x) => x.findingId === r.findingId);
      if (existing) return existing;
    }
    const rec: RecoveryRecord = { ...r, status: r.status ?? "flagged", id: uid("rec"), createdAt: today(), updatedAt: today() };
    update((s) => ({ ...s, recovery: [rec, ...s.recovery] }));
    return rec;
  },
  updateRecovery(id: string, patch: Partial<Pick<RecoveryRecord, "status" | "notes" | "amount">>) {
    const before = current().recovery.find((r) => r.id === id);
    if (before && patch.status === "recovered" && before.status !== "recovered") celebrate({ kind: "win", message: `${formatMoney(before.amount, before.currency)} recovered` });
    else if (before && patch.status && patch.status !== before.status) celebrate({ kind: "step", message: `Moved to ${patch.status.replace("_", " ")}` });
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
    update((s) => ({ ...seed, settings: s.settings, user: s.user.name ? s.user : seed.user }));
  },
  /** Replace everything with a backup file. Returns how many invalid records were skipped, or null if the file is not an Overbill backup. */
  restore(raw: string): { dropped: number } | null {
    const parsed = parseStoredState(raw);
    if (!parsed) return null;
    commit(parsed.state);
    return { dropped: parsed.dropped };
  },
  /** Remove only the fictional sample invoices (and what hangs off them). Anything the person added is kept. */
  removeSample() {
    update((s) => {
      const demo = new Set(s.invoices.filter((i) => i.source === "demo").map((i) => i.id));
      const seedIds = new Set(seedRecovery.map((r) => r.id)); // saved data from before records were labelled
      const invoices = s.invoices.filter((i) => !demo.has(i.id));
      const vendors = s.vendors.filter((v) => invoices.some((i) => i.vendorId === v.id));
      const kept = new Set(vendors.map((v) => v.id));
      const prefixes = [...demo].map((id) => `${id}:`);
      const decisions = Object.fromEntries(Object.entries(s.decisions).filter(([findingId]) => !prefixes.some((prefix) => findingId.startsWith(prefix))));
      return { ...s, invoices, vendors, contractRates: s.contractRates.filter((r) => kept.has(r.vendorId)), recovery: s.recovery.filter((r) => !(r.source === "demo" || seedIds.has(r.id) || (r.invoiceId && demo.has(r.invoiceId)))), decisions };
    });
  },
  /** Clear the sample set but keep the profile and settings. */
  startEmpty() {
    update((s) => ({ ...s, vendors: [], invoices: [], contractRates: [], recovery: [], decisions: {} }));
  },
  /** Remove every invoice, vendor and record, and blank the profile. Preferences (currency, sensitivity, toggles) are kept. */
  clearAll() {
    update((s) => ({ ...s, user: { id: s.user.id, name: "", email: "", company: "" }, vendors: [], invoices: [], contractRates: [], recovery: [], decisions: {} }));
  },
};

/** True when there is anything in the browser the person created themselves, as opposed to the fictional sample set. */
export function hasOwnData(s: AppState): boolean {
  const seedIds = new Set(seedRecovery.map((r) => r.id));
  return s.invoices.some((i) => i.source !== "demo") || s.recovery.some((r) => r.source !== "demo" && !seedIds.has(r.id));
}

/** Non-reactive read for event handlers. */
export function getSnapshotState(): AppState { return current(); }
