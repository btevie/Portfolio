"use client";
import { useSyncExternalStore } from "react";
import type {
  AppState, ContractRate, FindingDecision, Invoice, RecoveryRecord, RecoveryStatus, UserSettings, Vendor,
} from "../types";
import { newId } from "../ids";
import { celebrate } from "../celebrate";
import { formatMoney } from "../audit/money";
import { applyEvent, caseFigures, MAX_EVENTS, validateEvent, type EventInput } from "../recovery";
import { localRepository, type Repository } from "./repository";
import { parseStoredState } from "./validate-state";
import { createSeedState, recovery as seedRecovery } from "./seed";
import { addCreditNote, linkCredit, pruneCredits, recordSettlement, reverseSettlement, type CreditResult, type SettlementInput } from "../credits";

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
const creditCtx = () => ({ id: () => `ce-${newId().slice(0, 12)}`, now: () => new Date().toISOString() });
/** Run a credit-note rule; commit only when it passes. The error text is shown to the user as-is. */
function creditAction(fn: (s: AppState) => CreditResult): { ok: true } | { ok: false; error: string } {
  const r = fn(current());
  if (!r.ok) return r;
  commit(r.state);
  return { ok: true };
}
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
      return pruneCredits({ ...s, invoices: s.invoices.filter((i) => i.id !== id), decisions, recovery }, creditCtx());
    });
  },
  /** The user's own record of whether they paid. "overdue" is derived from the due date, never stored by hand. */
  setPaymentStatus(id: string, paymentStatus: "paid" | "unpaid") {
    update((s) => ({ ...s, invoices: s.invoices.map((i) => (i.id === id ? { ...i, paymentStatus } : i)) }));
  },
  /** `reason` is the user's own note for dismissing or confirming; it is kept with the decision and cleared when the finding is reopened. */
  setDecision(findingId: string, decision: FindingDecision, reason?: string) {
    update((s) => {
      const { [findingId]: _old, ...others } = s.decisionReasons ?? {}; void _old;
      const text = decision === "open" ? "" : (reason ?? s.decisionReasons?.[findingId] ?? "").trim().slice(0, 500);
      const decisionReasons = text ? { ...others, [findingId]: text } : others;
      return { ...s, decisions: { ...s.decisions, [findingId]: decision }, decisionReasons };
    });
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
    // Money milestones must go through recordRecoveryEvent, which validates an amount/date and keeps the timeline in sync.
    if (patch.status === "credit_issued" || patch.status === "recovered") return;
    if (patch.status === "dismissed" && before && (before.status === "credit_issued" || caseFigures(before).promised || caseFigures(before).resolved.gt(0))) return;
    if (before && patch.status && patch.status !== before.status) celebrate({ kind: "step", message: `Moved to ${patch.status.replace("_", " ")}` });
    update((s) => ({
      ...s,
      recovery: s.recovery.map((r) => {
        if (r.id !== id) return r;
        const changed = patch.status && patch.status !== r.status;
        const events = changed ? [...(r.events ?? []), { id: newId().slice(0, 12), at: new Date().toISOString(), kind: "status" as const, text: `Status set to ${patch.status!.replace("_", " ")} by you`, from: r.status, to: patch.status }].slice(-MAX_EVENTS) : r.events;
        const legacy = changed ? caseFigures(r) : null;
        return { ...r, ...(legacy?.legacy ? { recoveredAmount: legacy.received.toFixed(2) } : {}), ...patch, ...(events ? { events } : {}), updatedAt: today() };
      }),
    }));
  },
  /** Record something that happened on a case (contact, reply, promise, applied credit, money received). Returns an error message, or null when saved. */
  recordRecoveryEvent(id: string, input: EventInput): string | null {
    const before = current().recovery.find((r) => r.id === id);
    if (!before) return "That case no longer exists.";
    const error = validateEvent(before, input, today());
    if (error) return error;
    const after = applyEvent(before, input, today());
    if (before.status !== "recovered" && after.status === "recovered") celebrate({ kind: "win", message: `${formatMoney(caseFigures(after).resolved, after.currency)} recorded as back` });
    else celebrate({ kind: "step", message: "Saved to the case timeline" });
    update((s) => ({ ...s, recovery: s.recovery.map((r) => (r.id === id ? after : r)) }));
    return null;
  },
  /** Set or clear the follow-up date and the next-step note the user wants to be reminded of. */
  setRecoveryFollowUp(id: string, followUpDate: string | undefined, nextStep?: string) {
    update((s) => ({ ...s, recovery: s.recovery.map((r) => (r.id === id ? { ...r, followUpDate: followUpDate || undefined, nextStep: nextStep?.trim() || r.nextStep, updatedAt: today() } : r)) }));
  },
  /** Credit notes: link to a bill, record what the user confirmed happened, reverse a mistake, add a note. */
  linkCredit(creditId: string, invoiceId: string | null) { return creditAction((s) => linkCredit(s, creditId, invoiceId, creditCtx())); },
  recordCreditSettlement(creditId: string, input: SettlementInput) { return creditAction((s) => recordSettlement(s, creditId, input, { ...creditCtx(), today: today() })); },
  reverseCreditSettlement(creditId: string, eventId: string, reason: string) { return creditAction((s) => reverseSettlement(s, creditId, eventId, reason, creditCtx())); },
  addCreditNote(creditId: string, text: string) { return creditAction((s) => addCreditNote(s, creditId, text, creditCtx())); },
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
      return pruneCredits({ ...s, invoices, vendors, contractRates: s.contractRates.filter((r) => kept.has(r.vendorId)), recovery: s.recovery.filter((r) => !(r.source === "demo" || seedIds.has(r.id) || (r.invoiceId && demo.has(r.invoiceId)))), decisions }, creditCtx());
    });
  },
  /** Clear the sample set but keep the profile and settings. */
  startEmpty() {
    update((s) => ({ ...s, vendors: [], invoices: [], contractRates: [], recovery: [], credits: [], decisions: {}, decisionReasons: {} }));
  },
  /** Remove every invoice, vendor and record, and blank the profile. Preferences (currency, sensitivity, toggles) are kept. */
  clearAll() {
    update((s) => ({ ...s, user: { id: s.user.id, name: "", email: "", company: "" }, vendors: [], invoices: [], contractRates: [], recovery: [], credits: [], decisions: {}, decisionReasons: {} }));
  },
};

/** True when there is anything in the browser the person created themselves, as opposed to the fictional sample set. */
export function hasOwnData(s: AppState): boolean {
  const seedIds = new Set(seedRecovery.map((r) => r.id));
  return s.invoices.some((i) => i.source !== "demo") || s.recovery.some((r) => r.source !== "demo" && !seedIds.has(r.id));
}

/** Non-reactive read for event handlers. */
export function getSnapshotState(): AppState { return current(); }
