import { caseFigures, nextAction as caseNextAction } from "../recovery";
import { isSimulated } from "../evidence";
import { auditInvoice, configFromSettings, RULES } from "../audit/engine";
import { D, Decimal, pct, sum } from "../audit/money";
import { isDuplicateCopy, netOf } from "../audit/history";
import { daysBetween, normalizeDescription, normalizeInvoiceNumber, parseISO } from "../audit/normalize";
import type { AuditResult } from "../audit/types";
import type { AppState, AuditFinding, Classification, Currency, Invoice, RecoveryRecord, Vendor } from "../types";

/** Date-only invoice fields are calendar dates, so compare them in the user's local calendar. */
export const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** An unpaid invoice becomes overdue from its due date even if its stored status was never updated. */
export function paymentStatusAt(invoice: Invoice, asOf = today()): Invoice["paymentStatus"] {
  if (invoice.paymentStatus !== "unpaid") return invoice.paymentStatus;
  const due = parseISO(invoice.dueDate), now = parseISO(asOf);
  return due !== null && now !== null && due < now ? "overdue" : "unpaid";
}

export type Audits = Record<string, AuditResult>;

export function auditAll(state: AppState): Audits {
  const config = configFromSettings(state.settings);
  const asOf = today();
  const out: Audits = {};
  const bills = state.invoices.filter((i) => !i.isCredit && !isSimulated(i)); // credit notes are tracked, not audited, and are not price history; simulated invoices are invented, so they are never evidence about real ones
  for (const inv of state.invoices) {
    out[inv.id] = auditInvoice(inv, {
      today: asOf, invoices: bills, contractRates: state.contractRates,
      vendor: state.vendors.find((v) => v.id === inv.vendorId), config: inv.isCredit ? { ...config, disabledRules: RULES.map((r) => r.id) } : config,
    });
  }
  return out;
}

const RESOLVED = new Set(["recovered", "credit_issued", "dismissed"]);

/** Signature for recurring vendor fee patterns so dismissing an agreed fee suppresses future repeats for that vendor. */
function feeSignature(state: AppState, f: AuditFinding): string | null {
  if (f.ruleId !== "unexpected_fee") return null;
  const vendorId = state.invoices.find((i) => i.id === f.invoiceId)?.vendorId ?? f.invoiceId;
  const label = f.title.split(":")[0] ?? f.title;
  return `${vendorId}::${f.ruleId}::${normalizeDescription(label)}::${normalizeDescription(f.actual)}`;
}

function dismissedFeeSignatures(state: AppState, audits?: Audits): Set<string> {
  const sigs = new Set<string>();
  if (!audits) return sigs;
  for (const res of Object.values(audits)) {
    for (const f of res.findings) {
      if (state.decisions[f.id] === "dismissed") {
        const sig = feeSignature(state, f);
        if (sig) sigs.add(sig);
      }
    }
  }
  return sigs;
}

/** A finding is "open" until the user dismisses it, its recovery record is resolved, or the user already dismissed the exact same fee pattern for this vendor. */
export function isOpen(state: AppState, f: AuditFinding, audits?: Audits): boolean {
  if (state.decisions[f.id] === "dismissed") return false;
  const rec = state.recovery.find((r) => r.findingId === f.id);
  if (rec && RESOLVED.has(rec.status)) return false;
  if (audits) {
    const sig = feeSignature(state, f);
    if (sig && dismissedFeeSignatures(state, audits).has(sig)) return false;
  }
  return true;
}

export function openFindings(state: AppState, audits: Audits): AuditFinding[] {
  const dismissedSigs = dismissedFeeSignatures(state, audits);
  return Object.values(audits).flatMap((a) => a.findings).filter((f) => {
    if (!isOpen(state, f)) return false;
    const sig = feeSignature(state, f);
    return !(sig && dismissedSigs.has(sig));
  });
}

export function effectiveClassification(state: AppState, a: AuditResult, audits?: Audits): Classification {
  const open = a.findings.filter((f) => isOpen(state, f, audits));
  if (open.some((f) => f.classification === "LIKELY_ERROR")) return "LIKELY_ERROR";
  return open.length ? "REVIEW_NEEDED" : "CLEAR";
}

export function invoiceSort(a: Invoice, b: Invoice) {
  return (parseISO(b.date) ?? 0) - (parseISO(a.date) ?? 0) || b.createdAt - a.createdAt || b.id.localeCompare(a.id);
}

export interface DashboardMetrics {
  currency: Currency;
  invoicesChecked: number;
  potentialOvercharges: Decimal;
  excludedCurrencies: number;
  /** At-stake per currency (preferred first). Never summed across currencies. */
  atStake: CurrencyTotal[];
  recovered: Decimal;
  recoveryStats: RecoveryStats;
  needsReview: Invoice[];
  /** `flagged` = spend on invoices that still carry an open anomaly (re-sent copies counted once). */
  monthly: { label: string; total: number; flagged: number }[];
}

export function dashboardMetrics(state: AppState, audits: Audits, monthCount = 6): DashboardMetrics {
  const currency = state.settings.currency;
  const open = openFindings(state, audits);
  const stake = atStakeByCurrency(state, audits);
  const potential = stake.totals.find((t) => t.currency === currency)?.amount ?? D(0);
  const excluded = stake.totals.filter((t) => t.currency !== currency).reduce((n, t) => n + t.invoices, 0);
  const rec = recoveryStats(state.recovery, currency);
  const needsReview = state.invoices
    .filter((i) => !i.isCredit && !isSimulated(i) && effectiveClassification(state, audits[i.id]) !== "CLEAR")
    .sort(invoiceSort);

  // last N (default 6) calendar months ending at the latest invoice month
  const currencyInvoices = state.invoices.filter((i) => i.currency === currency && !i.isCredit && !isSimulated(i)); // credits and scripted examples are not real spend
  const latest = currencyInvoices.reduce((m, i) => Math.max(m, parseISO(i.date) ?? 0), 0) || Date.now();
  const end = new Date(latest);
  const months: { key: string; label: string; total: Decimal; flagged: Decimal }[] = [];
  for (let k = monthCount - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - k, 1));
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString("en", { month: "short", timeZone: "UTC" }), total: D(0), flagged: D(0) });
  }
  const flaggedInvoices = new Set(open.map((f) => f.invoiceId));
  const grouped = new Map<string, { invoice: Invoice; flagged: boolean }[]>();
  const chronological = [...currencyInvoices].sort((a, b) =>
      (parseISO(a.date) ?? 0) - (parseISO(b.date) ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  for (const i of chronological) {
    const number = normalizeInvoiceNumber(i.number);
    // An absent number cannot identify a resend; keep each such invoice separate.
    const key = `${i.vendorId}|${number || `invoice:${i.id}`}`;
    const candidates = grouped.get(key) ?? [];
    const existing = number ? candidates.find((group) => isDuplicateCopy(group.invoice, i)) : undefined;
    if (existing) { existing.invoice = i; existing.flagged ||= flaggedInvoices.has(i.id); }
    else candidates.push({ invoice: i, flagged: flaggedInvoices.has(i.id) });
    grouped.set(key, candidates);
  }
  for (const { invoice, flagged } of [...grouped.values()].flat()) {
    const m = months.find((x) => x.key === invoice.date.slice(0, 7));
    if (m) { m.total = m.total.plus(D(invoice.total)); if (flagged) m.flagged = m.flagged.plus(D(invoice.total)); }
  }
  return {
    currency, invoicesChecked: state.invoices.filter((i) => !i.isCredit && !isSimulated(i)).length, potentialOvercharges: potential, excludedCurrencies: excluded, atStake: stake.totals,
    recovered: rec.recovered, recoveryStats: rec, needsReview, monthly: months.map((m) => ({ label: m.label, total: m.total.toNumber(), flagged: m.flagged.toNumber() })),
  };
}

export interface VendorStats {
  vendor: Vendor;
  invoices: Invoice[]; // newest first, all copies
  unique: Invoice[]; // oldest first, re-sends removed, latest invoice's currency only
  otherCurrencyInvoices: number; // invoices excluded from the statistics because of a different currency
  invoiceCount: number;
  average: Decimal | null; // average of charges before the latest
  latest: Invoice | null;
  /** Change in net price (ex fees/tax) vs previous invoice (fixed) or prior average (usage-based). */
  changePct: number | null;
  trend: "up" | "down" | "flat";
  lastInvoiceDate: string | null;
  status: "Needs review" | "Price change" | "Building baseline" | "Stable" | "Paused";
  openFindings: AuditFinding[];
}

export function vendorStats(state: AppState, audits: Audits): VendorStats[] {
  return state.vendors.map((vendor) => {
    const all = state.invoices.filter((i) => i.vendorId === vendor.id && !i.isCredit && !isSimulated(i));
    const copyGroups = new Map<string, Invoice[]>();
    for (const i of [...all].sort((a, b) => (parseISO(a.date) ?? 0) - (parseISO(b.date) ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
      const number = normalizeInvoiceNumber(i.number);
      const key = `${i.currency}|${number || `invoice:${i.id}`}`;
      const copies = copyGroups.get(key) ?? [];
      const duplicateIndex = number ? copies.findIndex((copy) => isDuplicateCopy(copy, i)) : -1;
      if (duplicateIndex >= 0) copies[duplicateIndex] = i;
      else copies.push(i);
      copyGroups.set(key, copies);
    }
    const unique = [...copyGroups.values()].flat().sort((a, b) => (parseISO(a.date) ?? 0) - (parseISO(b.date) ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    // Statistics only ever compare amounts in one currency: that of the most recent invoice.
    const newest = unique[unique.length - 1] ?? null;
    const series = newest ? unique.filter((i) => i.currency === newest.currency) : [];
    const latest = series[series.length - 1] ?? null;
    const prior = series.slice(0, -1);
    const average = prior.length ? sum(prior.map((i) => D(i.total))).div(prior.length) : null;
    let changePct: number | null = null;
    if (latest && prior.length) {
      // Net pricing (before fees and tax), so a new fee or an arithmetic slip isn't reported as a price change.
      const nets = prior.map(netOf);
      const ref = vendor.billing === "variable" ? sum(nets).div(nets.length) : nets[nets.length - 1];
      changePct = ref.isZero() ? null : pct(netOf(latest).minus(ref), ref).toDecimalPlaces(1).toNumber();
    }
    const open = all.flatMap((i) => audits[i.id]?.findings ?? []).filter((f) => isOpen(state, f));
    const variableLimit = vendor.billing === "variable" ? 15 : 5;
    const status: VendorStats["status"] = !vendor.monitoring.enabled ? "Paused"
      : open.length ? "Needs review"
      : changePct !== null && changePct >= variableLimit ? "Price change"
      : series.length < 3 ? "Building baseline" : "Stable";
    return {
      vendor, invoices: [...all].sort(invoiceSort), unique: series, otherCurrencyInvoices: unique.length - series.length, invoiceCount: all.length, average, latest, changePct,
      trend: changePct === null || Math.abs(changePct) < 2 ? "flat" : changePct > 0 ? "up" : "down",
      lastInvoiceDate: all.length ? all.map((i) => i.date).sort().pop()! : null, status, openFindings: open,
    };
  });
}

export function detectRecurring(unique: Invoice[]): { monthly: Decimal; nextExpected: string } | null {
  if (unique.length < 3) return null;
  const gaps = unique.slice(1).map((inv, i) => daysBetween(parseISO(unique[i].date)!, parseISO(inv.date)!));
  if (!gaps.every((g) => g >= 25 && g <= 35)) return null;
  const totals = unique.map((i) => D(i.total));
  const avg = sum(totals).div(totals.length);
  if (avg.isZero()) return null;
  if (!totals.every((t) => t.minus(avg).abs().div(avg).lte("0.25"))) return null;
  const last = parseISO(unique[unique.length - 1].date)!;
  const next = new Date(last + 30 * 86_400_000).toISOString().slice(0, 10);
  return { monthly: D(unique[unique.length - 1].total), nextExpected: next };
}

export interface RecoveryStats {
  /** Still to collect: flagged, disputed, awaiting a reply, or a credit issued but not yet applied. */
  potential: Decimal;
  disputed: Decimal;
  /** Money actually received: refunds paid and credits applied (status "recovered"). */
  recovered: Decimal;
  /** Of `recovered`: refund money the user reports as received, and credit the user reports as applied. Both are self-reported. */
  received: Decimal;
  applied: Decimal;
  /** Promised by the vendor and not yet applied or received. */
  promisedOutstanding: Decimal;
  /** Credits the vendor has issued that haven't been applied/received yet (status "credit_issued"). */
  pendingCredit: Decimal;
  pendingCreditCount: number;
  /** Share of *closed* cases that paid out. Pending credits are not closed, so they count neither way. */
  rate: number | null;
  resolved: number;
  won: number;
}

/** Single source of truth for recovery figures. The dashboard and the tracker must both use this. */
export function recoveryStats(records: RecoveryRecord[], currency: Currency): RecoveryStats {
  const mine = records.filter((r) => r.currency === currency);
  const figs = mine.map((r) => ({ r, f: caseFigures(r) }));
  const OPEN = ["flagged", "disputed", "vendor_responded", "credit_issued"];
  // Open cases count only what has not arrived yet; whatever arrived (applied credit or refund) moves to "recovered".
  const left = (st: string[]) => sum(figs.filter(({ r }) => st.includes(r.status)).map(({ f }) => Decimal.max(f.claimed.minus(f.resolved), 0)));
  const won = mine.filter((r) => r.status === "recovered").length;
  const resolved = won + mine.filter((r) => r.status === "dismissed").length;
  return {
    potential: left(OPEN),
    disputed: left(["disputed", "vendor_responded"]),
    recovered: sum(figs.map(({ f }) => f.resolved)),
    received: sum(figs.map(({ f }) => f.received)),
    applied: sum(figs.map(({ f }) => f.applied)),
    promisedOutstanding: sum(figs.filter(({ r }) => r.status === "credit_issued").map(({ f }) => f.outstanding)),
    pendingCredit: sum(figs.filter(({ r }) => r.status === "credit_issued").map(({ f }) => f.outstanding)),
    pendingCreditCount: figs.filter(({ r, f }) => r.status === "credit_issued" && f.outstanding.gt(0)).length,
    rate: resolved ? Math.round((won / resolved) * 100) : null,
    resolved, won,
  };
}

/** Shared wording so both screens describe the numbers identically. */
export function pendingCreditNote(s: RecoveryStats, fmt: (d: Decimal) => string): string | null {
  return s.pendingCreditCount ? `${fmt(s.pendingCredit)} in credit issued, not yet applied` : null;
}

export interface QueueItem { finding: AuditFinding; invoice: Invoice }

/** Open anomalies, most urgent first: unpaid before paid, then severity, then earliest due date, then amount at risk. */
export function actionQueue(state: AppState, audits: Audits): QueueItem[] {
  const byId = new Map(state.invoices.map((i) => [i.id, i]));
  const sev = { high: 0, medium: 1, low: 2 } as const;
  return Object.values(audits).flatMap((a) => a.findings).filter((f) => isOpen(state, f))
    .flatMap((finding) => { const invoice = byId.get(finding.invoiceId); return invoice && !isSimulated(invoice) ? [{ finding, invoice }] : []; })
    .sort((a, b) =>
      Number(paymentStatusAt(a.invoice) === "paid") - Number(paymentStatusAt(b.invoice) === "paid")
      || sev[a.finding.severity] - sev[b.finding.severity]
      || a.invoice.dueDate.localeCompare(b.invoice.dueDate)
      || D(b.finding.amountAtRisk).comparedTo(D(a.finding.amountAtRisk)));
}

export type Urgency = "overdue" | "soon" | "later" | "paid";
export interface NextAction {
  id: string;
  kind: "invoice" | "followup";
  urgency: Urgency;
  severity: "high" | "medium" | "low";
  vendorName: string;
  /** Why it matters, in plain words. */
  reason: string;
  /** Possible (not confirmed) amount, always in its own currency. Null when no amount is evidenced. */
  amount: { value: string; currency: Currency } | null;
  /** Days until due (negative = overdue) for invoices, days since last update for follow-ups. */
  days: number | null;
  /** Follow-ups: true when `days` counts days past a date the user set, false when it counts days of silence. */
  dated?: boolean;
  findings: number;
  href: string;
  cta: string;
}

const DAY = 86_400_000;
const SEV = { high: 0, medium: 1, low: 2 } as const;
const TIER = { overdue: 0, soon: 1, later: 2, paid: 3 } as const;

/**
 * One ranked list for the dashboard: one row per invoice (its open findings are rolled up, never listed twice) plus
 * disputes that have gone quiet. Unpaid and overdue come first, then severity, then the larger amount, but amounts are
 * only compared inside one currency, so nothing is ever converted or added across currencies.
 */
export function nextActions(state: AppState, audits: Audits, now = Date.now()): NextAction[] {
  const out: NextAction[] = [];
  const soonDays = state.settings.reminders.dueWithinDays;
  const todayMs = parseISO(today()) ?? 0;
  for (const inv of state.invoices) {
    if (inv.isCredit || isSimulated(inv)) continue;
    const open = (audits[inv.id]?.findings ?? []).filter((f) => isOpen(state, f));
    if (!open.length) continue;
    const status = paymentStatusAt(inv);
    // Already paid and every open finding has its own case: the case carries the next step, so the invoice would be a second queue entry.
    if (status === "paid" && open.every((f) => state.recovery.some((r) => r.findingId === f.id && r.status !== "dismissed"))) continue;
    const dueMs = parseISO(inv.dueDate);
    const days = dueMs === null ? null : Math.round((dueMs - todayMs) / DAY);
    const urgency: Urgency = status === "paid" ? "paid" : status === "overdue" || (days !== null && days < 0) ? "overdue" : days !== null && days <= soonDays ? "soon" : "later";
    const severity = open.reduce<"high" | "medium" | "low">((m, f) => (SEV[f.severity] < SEV[m] ? f.severity : m), "low");
    const exposure = invoiceExposure(open, inv.total);
    const top = [...open].sort((a, b) => SEV[a.severity] - SEV[b.severity])[0];
    const more = open.length > 1 ? ` and ${open.length - 1} more` : "";
    out.push({
      id: `inv:${inv.id}`, kind: "invoice", urgency, severity, vendorName: inv.vendorName,
      reason: `${top.title}${more}`,
      amount: exposure.gt(0) ? { value: exposure.toFixed(2), currency: inv.currency } : null,
      days, findings: open.length,
      href: `/invoices/${inv.id}?finding=${encodeURIComponent(top.id)}`,
      cta: urgency === "paid" ? "Review and ask for a refund" : "Review before paying",
    });
  }
  const replyAfter = state.settings.reminders.replyAfterDays;
  for (const c of state.recovery) {
    if (c.status === "dismissed" || c.status === "recovered") continue;
    const href = `/recovery?case=${encodeURIComponent(c.id)}`;
    const figs = caseFigures(c);
    const owed = figs.outstanding.gt(0) ? figs.outstanding : D(c.amount);
    const amount = owed.gt(0) ? { value: owed.toFixed(2), currency: c.currency } : null;
    // A follow-up date the user set (or an expected refund date that passed) comes first.
    const step = caseNextAction(c, today());
    if (step && step.overdueDays > 0) {
      out.push({ id: `case:${c.id}`, kind: "followup", urgency: "overdue", severity: "medium", vendorName: c.vendorName, reason: `${step.label}. ${c.title}`, amount, days: step.overdueDays, dated: true, findings: 0, href, cta: c.status === "credit_issued" ? "Check whether it arrived" : "Follow up with the vendor" });
      continue;
    }
    if (c.status !== "disputed" || c.followUpDate) continue; // a dated follow-up that is not due yet is not a nudge
    const t = Date.parse(c.updatedAt);
    if (!Number.isFinite(t)) continue;
    const quiet = Math.floor((now - t) / DAY);
    if (quiet < replyAfter) continue;
    out.push({ id: `case:${c.id}`, kind: "followup", urgency: "overdue", severity: "medium", vendorName: c.vendorName, reason: `Dispute with no update for ${quiet} days: ${c.title}`, amount, days: quiet, dated: false, findings: 0, href, cta: "Follow up with the vendor" });
  }
  return out.sort((a, b) =>
    TIER[a.urgency] - TIER[b.urgency]
    || SEV[a.severity] - SEV[b.severity]
    // Amounts are only comparable inside one currency, so group by currency first: a consistent order, with no cross-currency comparison.
    || (a.amount?.currency ?? "").localeCompare(b.amount?.currency ?? "")
    || (a.amount && b.amount ? D(b.amount.value).comparedTo(D(a.amount.value)) : 0)
    || (a.days ?? 9999) - (b.days ?? 9999));
}

export interface VendorStake { vendorId: string; vendorName: string; amount: Decimal; findings: number }

/** Amount at stake per vendor (only findings in `currency`, nothing converted), largest first. */
export function stakeByVendor(queue: QueueItem[], currency: Currency): VendorStake[] {
  const by = new Map<string, VendorStake>();
  const perInvoice = new Map<string, { invoice: Invoice; findings: AuditFinding[] }>();
  for (const { finding, invoice } of queue) {
    if (invoice.currency !== currency) continue;
    const group = perInvoice.get(invoice.id) ?? { invoice, findings: [] };
    group.findings.push(finding);
    perInvoice.set(invoice.id, group);
  }
  for (const { invoice, findings } of perInvoice.values()) {
    const amount = invoiceExposure(findings, invoice.total);
    if (!amount.gt(0)) continue;
    const cur = by.get(invoice.vendorId) ?? { vendorId: invoice.vendorId, vendorName: invoice.vendorName, amount: D(0), findings: 0 };
    cur.amount = cur.amount.plus(amount); cur.findings += findings.length;
    by.set(invoice.vendorId, cur);
  }
  return [...by.values()].sort((a, b) => b.amount.comparedTo(a.amount));
}

/**
 * What is really at stake on one invoice. Several findings can describe the SAME money (a bad line total also makes the
 * subtotal and total wrong; a duplicate invoice makes every other finding on it moot), so summing them inflates exposure.
 * Rules: a duplicate invoice covers the whole total; arithmetic findings are one cascade, so only the largest counts;
 * every other rule is independent and adds up. Never more than the invoice total.
 */
export function invoiceExposure(open: AuditFinding[], invoiceTotal: string): Decimal {
  const total = D(invoiceTotal);
  if (open.some((f) => f.ruleId === "duplicate_invoice" && D(f.amountAtRisk).gt(0))) return total;
  const arithmetic = open.filter((f) => f.ruleId === "arithmetic").reduce((m, f) => (D(f.amountAtRisk).gt(m) ? D(f.amountAtRisk) : m), D(0));
  const rest = sum(open.filter((f) => f.ruleId !== "arithmetic").map((f) => D(f.amountAtRisk)));
  const exposure = arithmetic.plus(rest);
  return total.gt(0) && exposure.gt(total) ? total : exposure;
}

export interface CurrencyTotal { currency: Currency; amount: Decimal; invoices: number }

/** Money at stake per currency. Overbill never converts, so currencies are never added together. Preferred currency first. */
export function atStakeByCurrency(state: AppState, audits: Audits): { totals: CurrencyTotal[]; tone: "bad" | "warn" | null } {
  const map = new Map<Currency, CurrencyTotal>();
  let tone: "bad" | "warn" | null = null;
  for (const inv of state.invoices) {
    if (inv.isCredit || isSimulated(inv)) continue; // simulated figures are invented: never part of a money total
    const a = audits[inv.id];
    if (!a) continue;
    const open = a.findings.filter((f) => isOpen(state, f));
    const amount = invoiceExposure(open, inv.total);
    if (!amount.gt(0)) continue;
    const t = map.get(inv.currency) ?? { currency: inv.currency, amount: D(0), invoices: 0 };
    map.set(inv.currency, { ...t, amount: t.amount.plus(amount), invoices: t.invoices + 1 });
    if (effectiveClassification(state, a) === "LIKELY_ERROR") tone = "bad"; else tone ??= "warn";
  }
  const pref = state.settings.currency;
  const totals = [...map.values()].sort((a, b) => (a.currency === pref ? -1 : b.currency === pref ? 1 : Number(b.amount) - Number(a.amount)));
  return { totals, tone };
}

const fmtShortDate = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface Reminder { id: string; kind: "review" | "due" | "reply" | "renewal"; text: string; href: string }

/** In-app reminders only (nothing is emailed or pushed). Each type honours its Settings toggle. */
export function activeReminders(state: AppState, audits: Audits, now = Date.now()): Reminder[] {
  const r = state.settings.reminders;
  const out: Reminder[] = [];
  const day = 86_400_000;
  const vendors = new Map(state.vendors.map((v) => [v.id, v]));
  const canNotify = (vendorId: string) => {
    const vendor = vendors.get(vendorId);
    return !vendor || vendor.monitoring.notify;
  };
  const withOpen = state.invoices.filter((i) => canNotify(i.vendorId) && !isSimulated(i) && audits[i.id]?.findings.some((f) => isOpen(state, f)));
  if (r.overdueReview) {
    const stale = withOpen.filter((i) => (now - i.createdAt) / day >= r.reviewAfterDays);
    if (stale.length) out.push({ id: `review:${stale.map((i) => i.id).sort().join(",")}`, kind: "review", text: `${stale.length} flagged invoice${stale.length === 1 ? " has" : "s have"} waited over ${r.reviewAfterDays} days for review`, href: "/invoices?status=attention" });
  }
  if (r.upcomingDue) {
    for (const i of withOpen.filter((x) => x.paymentStatus !== "paid")) {
      const due = parseISO(i.dueDate);
      if (due === null) continue;
      const days = Math.round((due - (parseISO(today()) ?? due)) / day);
      if (days <= r.dueWithinDays) {
        const invoiceLabel = i.number.trim() ? ` ${i.number}` : "";
        const dueLabel = days < 0 ? `was due ${-days} day${days === -1 ? "" : "s"} ago` : days === 0 ? "is due today" : `is due in ${days} day${days === 1 ? "" : "s"}`;
        out.push({ id: `due:${i.id}:${i.dueDate}`, kind: "due", text: `${i.vendorName}${invoiceLabel} ${dueLabel}, with open findings`, href: `/invoices/${i.id}` });
      }
    }
  }
  if (r.upcomingDue) {
    // Renewals you entered: the date that matters is the notice deadline, not the renewal itself.
    for (const v of state.vendors) {
      const c = v.contract;
      const renew = c?.renewalDate ? parseISO(c.renewalDate) : null;
      if (!c || renew === null || !canNotify(v.id)) continue;
      const notice = c.noticeDays ?? 0;
      const toRenewal = Math.round((renew - (parseISO(today()) ?? renew)) / day);
      const toNotice = toRenewal - notice;
      if (toRenewal < 0 || toNotice > 30) continue;
      const when = toNotice > 0 ? `Decide by ${fmtShortDate(renew - notice * day)} (${toNotice} day${toNotice === 1 ? "" : "s"})` : `The notice period has started; renewal is in ${toRenewal} day${toRenewal === 1 ? "" : "s"}`;
      out.push({ id: `renewal:${v.id}:${c.renewalDate}`, kind: "renewal", text: `${v.name} renews on ${c.renewalDate}. ${when} if you want to cancel or renegotiate.`, href: `/vendors/${v.id}` });
    }
  }
  if (r.vendorReply) {
    for (const c of state.recovery.filter((x) => x.status === "disputed" && canNotify(x.vendorId))) {
      const t = Date.parse(c.updatedAt);
      if (Number.isFinite(t) && (now - t) / day >= r.replyAfterDays) out.push({ id: `reply:${c.id}:${c.updatedAt}`, kind: "reply", text: `No update from ${c.vendorName} for ${Math.floor((now - t) / day)} days on "${c.title}"`, href: "/recovery" });
    }
  }
  return out;
}
