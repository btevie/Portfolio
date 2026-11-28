import { isCurrency } from "../currencies";
import { MAX_CREDIT_EVENTS } from "../credits";
import { isValidDecimal, MAX_INT_DIGITS } from "../audit/money";
import { parseISO } from "../audit/normalize";
import type { AppState, ContractRate, CreditEvent, CreditRecord, FindingDecision, Invoice, InvoiceLineItem, MedicalBill, RecoveryRecord, UserSettings, Vendor } from "../types";
import { createSeedState } from "./seed";

/**
 * localStorage is user- (and extension-, and same-origin-script-) writable, so stored state is untrusted input.
 * Each record is validated individually: bad records are dropped and counted, never rendered.
 * Only a structurally unusable top level makes the whole load fail (the caller then falls back to the demo seed).
 */
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown, max = 500): x is string => typeof x === "string" && x.length <= max;
const recordId = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(x);
// Credit notes are unsupported, so a negative amount in saved or restored data is never legitimate.
const dec = (x: unknown): x is string => typeof x === "string" && !x.trim().startsWith("-") && isValidDecimal(x);
const oneOf = <T extends string>(x: unknown, set: readonly T[]): x is T => typeof x === "string" && (set as readonly string[]).includes(x);
const optDec = (x: unknown) => x === undefined || dec(x);

const CATEGORIES = ["Infrastructure", "Cloud usage", "Telecom", "Workspace", "Software", "Professional services", "Other"] as const;
const PAYMENT = ["unpaid", "paid", "overdue"] as const;
const RECOVERY = ["flagged", "disputed", "vendor_responded", "credit_issued", "recovered", "dismissed"] as const;
const DECISIONS = ["open", "confirmed", "dismissed"] as const;
const SENS = ["relaxed", "balanced", "strict"] as const;
const RULES = ["arithmetic", "tax", "duplicate_invoice", "duplicate_line", "dates", "price_history", "contract_rate", "unexpected_fee"] as const;
const DATE_FORMATS = ["dmy", "mdy", "iso", "long"] as const;
const MAX_LINES = 500;
/** Upper bounds on saved records, so a hand-edited or runaway backup cannot freeze the app. */
export const MAX_RECORDS = { invoices: 5000, vendors: 1000, contractRates: 2000, recovery: 5000 } as const;

function line(x: unknown): x is InvoiceLineItem {
  return isObj(x) && recordId(x.id) && str(x.description, 300) && dec(x.quantity) && dec(x.unitPrice) && dec(x.total)
    && oneOf(x.kind, ["item", "fee"] as const) && optDec(x.taxRate);
}

function lines(x: unknown): x is InvoiceLineItem[] {
  if (!Array.isArray(x) || x.length > MAX_LINES) return false;
  const ids = new Set<string>();
  for (const item of x) {
    if (!line(item) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

function invoice(x: unknown): x is Invoice {
  return isObj(x) && recordId(x.id) && recordId(x.vendorId) && str(x.vendorName, 200) && x.vendorName.trim().length > 0 && str(x.number, 100) && str(x.date, 40) && str(x.dueDate, 40)
    && isCurrency(x.currency) && lines(x.lineItems)
    && dec(x.subtotal) && dec(x.discounts) && dec(x.fees) && dec(x.taxAmount) && dec(x.total) && optDec(x.taxRate)
    && oneOf(x.paymentStatus, PAYMENT) && oneOf(x.source, ["demo", "upload"] as const) && Number.isFinite(x.createdAt)
    && (x.extraction === undefined || oneOf(x.extraction, ["mock", "csv", "text", "pdf", "ocr"] as const))
    && (x.medical === undefined || typeof x.medical === "boolean")
    && (x.readNotes === undefined || (Array.isArray(x.readNotes) && x.readNotes.length <= 10 && x.readNotes.every((n) => str(n, 300))))
    && (x.uncertainFields === undefined || (Array.isArray(x.uncertainFields) && x.uncertainFields.length <= 10 && x.uncertainFields.every((k) => str(k, 30))))
    && (x.isCredit === undefined || typeof x.isCredit === "boolean");
}

function vendor(x: unknown): x is Vendor {
  return isObj(x) && recordId(x.id) && str(x.name, 200) && x.name.trim().length > 0 && oneOf(x.category, CATEGORIES) && oneOf(x.billing, ["fixed", "variable"] as const)
    && optDec(x.expectedAmount) && (x.expectedCurrency === undefined || isCurrency(x.expectedCurrency))
    && isObj(x.monitoring) && typeof x.monitoring.enabled === "boolean" && typeof x.monitoring.notify === "boolean"
    && (x.contract === undefined || (isObj(x.contract)
      && (x.contract.renewalDate === undefined || (typeof x.contract.renewalDate === "string" && parseISO(x.contract.renewalDate) !== null))
      && (x.contract.noticeDays === undefined || (typeof x.contract.noticeDays === "number" && Number.isInteger(x.contract.noticeDays) && x.contract.noticeDays >= 0 && x.contract.noticeDays <= 730))
      && (x.contract.upliftCapPct === undefined || (typeof x.contract.upliftCapPct === "string" && /^\d{1,3}(\.\d{1,2})?$/.test(x.contract.upliftCapPct)))));
}

function rate(x: unknown): x is ContractRate {
  return isObj(x) && recordId(x.id) && recordId(x.vendorId) && str(x.match, 200) && x.match.trim().length > 0 && dec(x.unitPrice) && str(x.unit, 50) && isCurrency(x.currency);
}

function recovery(x: unknown): x is RecoveryRecord {
  return isObj(x) && recordId(x.id) && recordId(x.vendorId) && str(x.vendorName, 200) && str(x.title, 300) && dec(x.amount) && isCurrency(x.currency)
    && oneOf(x.status, RECOVERY) && str(x.notes, 5000) && str(x.createdAt, 40) && parseISO(x.createdAt) !== null && str(x.updatedAt, 40) && parseISO(x.updatedAt) !== null
    && (x.invoiceId === undefined || recordId(x.invoiceId)) && (x.findingId === undefined || str(x.findingId, 600));
}

const EVENT_KINDS = ["opened", "note", "status", "disputed", "vendor_response", "credit_issued", "applied", "received", "correction", "next_step", "deadline", "edit", "closed", "reopened"] as const;
const isoDate = (x: unknown): x is string => str(x, 40) && parseISO(x) !== null;

/** Optional tracking fields were added after the first release. Keep valid ones, drop malformed ones, never drop the record itself. */
export function cleanRecoveryExtras(r: RecoveryRecord): RecoveryRecord {
  const o = r as unknown as Obj;
  const out: Obj = { ...o };
  for (const k of ["confirmedAmount", "recoveredAmount", "appliedAmount"]) if (k in o && !dec(o[k])) delete out[k];
  if ("followUpDate" in o && !isoDate(o.followUpDate)) delete out.followUpDate;
  if ("nextStep" in o && !str(o.nextStep, 300)) delete out.nextStep;
  if ("deadline" in o) {
    const d = o.deadline;
    if (!(isObj(d) && isoDate(d.date) && str(d.label, 200) && str(d.source, 300))) delete out.deadline;
  }
  if ("events" in o) {
    out.events = Array.isArray(o.events)
      ? o.events.filter((e): e is Obj => isObj(e) && str(e.id, 64) && str(e.at, 40) && Number.isFinite(Date.parse(e.at)) && oneOf(e.kind, EVENT_KINDS) && str(e.text, 2000)
          && (e.amount === undefined || dec(e.amount)) && (e.reference === undefined || str(e.reference, 200)) && (e.date === undefined || isoDate(e.date))
          && (e.from === undefined || oneOf(e.from, RECOVERY)) && (e.to === undefined || oneOf(e.to, RECOVERY))).slice(-200)
      : undefined;
    if (out.events === undefined) delete out.events;
  }
  if ("source" in o && !oneOf(o.source, ["demo", "user"] as const)) delete out.source;
  return out as unknown as RecoveryRecord;
}

const CREDIT_EVENTS = ["linked", "unlinked", "applied", "refunded", "reversed", "note"] as const;

function creditEvent(x: unknown): x is CreditEvent {
  if (!isObj(x) || !recordId(x.id) || !str(x.at, 40) || Number.isNaN(Date.parse(x.at)) || !oneOf(x.kind, CREDIT_EVENTS) || !str(x.text, 2000)) return false;
  if (!optDec(x.amount) || (x.date !== undefined && !(str(x.date, 40) && parseISO(x.date) !== null))) return false;
  if (x.reference !== undefined && !str(x.reference, 200)) return false;
  if (x.invoiceId !== undefined && !recordId(x.invoiceId)) return false;
  if (x.invoiceLabel !== undefined && !str(x.invoiceLabel, 400)) return false;
  if (x.reverses !== undefined && !recordId(x.reverses)) return false;
  if (x.confirmed !== undefined && typeof x.confirmed !== "boolean") return false;
  // A settlement without an amount, date, reference and confirmation could not have been recorded by the app, so it is not trusted.
  if ((x.kind === "applied" || x.kind === "refunded") && !(typeof x.amount === "string" && x.date && x.reference && x.confirmed === true)) return false;
  return true;
}

function creditRecord(x: unknown): x is CreditRecord {
  if (!isObj(x) || !recordId(x.id) || !recordId(x.creditId) || (x.relatedInvoiceId !== undefined && !recordId(x.relatedInvoiceId))) return false;
  if (!Array.isArray(x.events) || x.events.length > MAX_CREDIT_EVENTS || !x.events.every(creditEvent)) return false;
  return new Set(x.events.map((e: CreditEvent) => e.id)).size === x.events.length;
}

function settings(x: unknown): x is UserSettings {
  if (!isObj(x) || !isCurrency(x.currency) || !(oneOf(x.sensitivity, SENS) || x.sensitivity === "custom")
    || !isObj(x.thresholds) || ![x.thresholds.info, x.thresholds.review, x.thresholds.high].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1000)
    || !dec(x.tolerance) || !isObj(x.privacy) || typeof x.privacy.analytics !== "boolean"
    || !Array.isArray(x.disabledRules) || x.disabledRules.length > RULES.length || !x.disabledRules.every((r) => oneOf(r, RULES))
    || !Array.isArray(x.exceptions) || x.exceptions.length > 1000
    || !x.exceptions.every((e) => isObj(e) && str(e.id) && str(e.vendorId) && oneOf(e.ruleId, ["price_history", "unexpected_fee"] as const)
      && str(e.reason, 1000) && (e.expiresOn === undefined || (str(e.expiresOn, 40) && parseISO(e.expiresOn) !== null))
      && str(e.createdAt, 40) && parseISO(e.createdAt) !== null)
    || !isObj(x.defaults) || !oneOf(x.defaults.dateFormat, DATE_FORMATS) || !str(x.defaults.timezone, 100) || !x.defaults.timezone.trim()
    || !Number.isInteger(x.defaults.paymentTermsDays) || (x.defaults.paymentTermsDays as number) < 0 || (x.defaults.paymentTermsDays as number) > 3650
    || !isObj(x.reminders) || typeof x.reminders.overdueReview !== "boolean" || typeof x.reminders.upcomingDue !== "boolean"
    || typeof x.reminders.vendorReply !== "boolean" || typeof x.reminders.browser !== "boolean"
    || ![x.reminders.reviewAfterDays, x.reminders.dueWithinDays, x.reminders.replyAfterDays].every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 3650)
    || !isObj(x.setup) || typeof x.setup.defaultsConfirmed !== "boolean" || typeof x.setup.dismissed !== "boolean") return false;
  return true;
}

function list<T extends { id: string }>(x: unknown, ok: (v: unknown) => v is T, max: number): { items: T[]; dropped: number } | null {
  if (!Array.isArray(x)) return null;
  const seen = new Set<string>();
  const items: T[] = [];
  for (const v of x) {
    if (!ok(v) || seen.has(v.id) || items.length >= max) continue; // invalid, repeated id or over the cap: skipped and counted
    seen.add(v.id);
    items.push(v);
  }
  return { items, dropped: x.length - items.length };
}

/** A profile picture is either a small image data URL or a plain https address. Anything else is dropped. */
export const validPicture = (v: string) => (v.length <= 400_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) || (v.length <= 2000 && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\/[^\s"'<>]*$/i.test(v));

export function parseStoredState(raw: string): { state: AppState; dropped: number } | null {
  let x: unknown;
  try { x = JSON.parse(raw); } catch { return null; }
  if (!isObj(x) || x.version !== 1) return null;
  const inv = list(x.invoices, invoice, MAX_RECORDS.invoices), ven = list(x.vendors, vendor, MAX_RECORDS.vendors), rt = list(x.contractRates, rate, MAX_RECORDS.contractRates), rec = list(x.recovery, recovery, MAX_RECORDS.recovery);
  if (!inv || !ven || !rt || !rec) return null;

  const seed = createSeedState();
  const latestCurrency = new Map<string, Invoice>();
  for (const i of inv.items) {
    const old = latestCurrency.get(i.vendorId);
    if (!old || (parseISO(i.date) ?? 0) > (parseISO(old.date) ?? 0) || (i.date === old.date && i.createdAt > old.createdAt)) latestCurrency.set(i.vendorId, i);
  }
  const fallbackCurrency = isObj(x.settings) && isCurrency(x.settings.currency) ? x.settings.currency : seed.settings.currency;
  const vendorItems = ven.items.map((v) => v.expectedAmount && !v.expectedCurrency
    ? { ...v, expectedCurrency: latestCurrency.get(v.id)?.currency ?? fallbackCurrency }
    : v);
  const decisions: Record<string, FindingDecision> = {};
  let dropped = inv.dropped + ven.dropped + rt.dropped + rec.dropped;
  const recoveryByFinding = new Map<string, RecoveryRecord>();
  const unlinkedRecovery: RecoveryRecord[] = [];
  for (const item of rec.items) {
    if (!item.findingId) { unlinkedRecovery.push(item); continue; }
    const existing = recoveryByFinding.get(item.findingId);
    if (!existing || item.updatedAt > existing.updatedAt) recoveryByFinding.set(item.findingId, item);
    if (existing) dropped++;
  }
  // Credit tracking is optional (older saves have none). Keep only records for credit notes that exist, one per credit note.
  const creditIds = new Set(inv.items.filter((i) => i.isCredit).map((i) => i.id));
  const billIds = new Set(inv.items.filter((i) => !i.isCredit).map((i) => i.id));
  const rawCredits = Array.isArray(x.credits) ? x.credits : [];
  const cr = list(rawCredits, creditRecord, MAX_RECORDS.invoices);
  const seenCredit = new Set<string>();
  const creditItems: CreditRecord[] = [];
  for (const c of cr?.items ?? []) {
    if (!creditIds.has(c.creditId) || seenCredit.has(c.creditId)) { dropped++; continue; }
    seenCredit.add(c.creditId);
    creditItems.push(c.relatedInvoiceId && !billIds.has(c.relatedInvoiceId) ? { ...c, relatedInvoiceId: undefined } : c);
  }
  dropped += cr?.dropped ?? 0;
  const recoveryItems = [...unlinkedRecovery, ...recoveryByFinding.values()].map(cleanRecoveryExtras);
  if (isObj(x.decisions)) {
    for (const [k, v] of Object.entries(x.decisions)) { if (k !== "__proto__" && k.length <= 600 && oneOf(v, DECISIONS)) decisions[k] = v; else dropped++; }
  }
  const decisionReasons: Record<string, string> = {};
  if (isObj(x.decisionReasons)) {
    for (const [k, v] of Object.entries(x.decisionReasons)) { if (k !== "__proto__" && k in decisions && typeof v === "string" && v.length > 0 && v.length <= 500) decisionReasons[k] = v; else dropped++; }
  }
  // Medical-bill tracking is optional (older saves have none). Keep only entries for bills that exist, with every field checked.
  const medicalBills: Record<string, MedicalBill> = {};
  if (isObj(x.medicalBills)) {
    const ids = new Set(inv.items.map((i) => i.id));
    for (const [k, v] of Object.entries(x.medicalBills)) {
      if (!ids.has(k)) continue; // its bill was deleted: nothing to keep, and not an error
      const ok = k !== "__proto__" && isObj(v)
        && [v.statementCheckedOn, v.itemisedReceivedOn, v.statementDate, v.payAnywayOn].every((d) => d === undefined || (str(d, 12) && parseISO(d) !== null))
        && (v.patientResponsibility === undefined || (str(v.patientResponsibility, 24) && isValidDecimal(v.patientResponsibility) && !v.patientResponsibility.startsWith("-")))
        && (v.forPerson === undefined || str(v.forPerson, 60))
        && Array.isArray(v.deadlines) && v.deadlines.length <= 50
        && v.deadlines.every((d: unknown) => isObj(d) && recordId(d.id) && str(d.date, 12) && parseISO(d.date) !== null && str(d.label, 120) && str(d.source, 200) && str(d.addedOn, 12) && parseISO(d.addedOn) !== null);
      if (ok) medicalBills[k] = v as unknown as MedicalBill; else dropped++;
    }
  }
  const user = isObj(x.user) && str(x.user.id) && str(x.user.name, 200) && str(x.user.email, 320) && str(x.user.company, 200)
    ? { id: x.user.id, name: x.user.name, email: x.user.email, company: x.user.company, ...(typeof x.user.picture === "string" && validPicture(x.user.picture) ? { picture: x.user.picture } : {}) } : seed.user;
  // Settings saved by older versions lack the newer fields; fill them from defaults before validating.
  if (isObj(x.settings)) { const { notifications: _old, ...rest } = x.settings; void _old; x.settings = { ...seed.settings, ...rest, reminders: { ...seed.settings.reminders, ...(isObj(rest.reminders) ? rest.reminders : {}) } }; }
  const s = settings(x.settings)
    ? { ...x.settings, privacy: { keepUploadedFiles: false as const, analytics: x.settings.privacy.analytics } } : seed.settings;
  if (!settings(x.settings)) dropped++;

  return { state: { version: 1, user, vendors: vendorItems, invoices: inv.items, contractRates: rt.items, recovery: recoveryItems, credits: creditItems, decisions, ...(Object.keys(decisionReasons).length ? { decisionReasons } : {}), ...(Object.keys(medicalBills).length ? { medicalBills } : {}), settings: s }, dropped };
}

export const LIMITS = { MAX_LINES, MAX_INT_DIGITS };
