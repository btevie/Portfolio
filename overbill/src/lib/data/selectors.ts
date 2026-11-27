import { auditInvoice, configFromSettings, RULES } from "../audit/engine";
import { D, Decimal, pct, sum } from "../audit/money";
import { isDuplicateCopy, netOf } from "../audit/history";
import { daysBetween, normalizeInvoiceNumber, parseISO } from "../audit/normalize";
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
  const bills = state.invoices.filter((i) => !i.isCredit); // credit notes are tracked, not audited, and are not price history
  for (const inv of state.invoices) {
    out[inv.id] = auditInvoice(inv, {
      today: asOf, invoices: bills, contractRates: state.contractRates,
      vendor: state.vendors.find((v) => v.id === inv.vendorId), config: inv.isCredit ? { ...config, disabledRules: RULES.map((r) => r.id) } : config,
    });
  }
  return out;
}

const RESOLVED = new Set(["recovered", "credit_issued", "dismissed"]);

/** A finding is "open" until the user dismisses it or its recovery record is resolved. */
export function isOpen(state: AppState, f: AuditFinding): boolean {
  if (state.decisions[f.id] === "dismissed") return false;
  const rec = state.recovery.find((r) => r.findingId === f.id);
  return !(rec && RESOLVED.has(rec.status));
}

export function openFindings(state: AppState, audits: Audits): AuditFinding[] {
  return Object.values(audits).flatMap((a) => a.findings).filter((f) => isOpen(state, f));
}

export function effectiveClassification(state: AppState, a: AuditResult): Classification {
  const open = a.findings.filter((f) => isOpen(state, f));
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
    .filter((i) => !i.isCredit && effectiveClassification(state, audits[i.id]) !== "CLEAR")
    .sort(invoiceSort);

  // last N (default 6) calendar months ending at the latest invoice month
  const currencyInvoices = state.invoices.filter((i) => i.currency === currency && !i.isCredit); // credit notes are not spend
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
    currency, invoicesChecked: state.invoices.filter((i) => !i.isCredit).length, potentialOvercharges: potential, excludedCurrencies: excluded, atStake: stake.totals,
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
    const all = state.invoices.filter((i) => i.vendorId === vendor.id && !i.isCredit);
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
  const amt = (st: string[]) => sum(mine.filter((r) => st.includes(r.status)).map((r) => D(r.amount)));
  const won = mine.filter((r) => r.status === "recovered").length;
  const resolved = won + mine.filter((r) => r.status === "dismissed").length;
  return {
    potential: amt(["flagged", "disputed", "vendor_responded", "credit_issued"]),
    disputed: amt(["disputed", "vendor_responded"]),
    recovered: amt(["recovered"]),
    pendingCredit: amt(["credit_issued"]),
    pendingCreditCount: mine.filter((r) => r.status === "credit_issued").length,
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
    .flatMap((finding) => { const invoice = byId.get(finding.invoiceId); return invoice ? [{ finding, invoice }] : []; })
    .sort((a, b) =>
      Number(paymentStatusAt(a.invoice) === "paid") - Number(paymentStatusAt(b.invoice) === "paid")
      || sev[a.finding.severity] - sev[b.finding.severity]
      || a.invoice.dueDate.localeCompare(b.invoice.dueDate)
      || D(b.finding.amountAtRisk).comparedTo(D(a.finding.amountAtRisk)));
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
    if (inv.isCredit) continue;
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

export interface Reminder { id: string; kind: "review" | "due" | "reply"; text: string; href: string }

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
  const withOpen = state.invoices.filter((i) => canNotify(i.vendorId) && audits[i.id]?.findings.some((f) => isOpen(state, f)));
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
  if (r.vendorReply) {
    for (const c of state.recovery.filter((x) => x.status === "disputed" && canNotify(x.vendorId))) {
      const t = Date.parse(c.updatedAt);
      if (Number.isFinite(t) && (now - t) / day >= r.replyAfterDays) out.push({ id: `reply:${c.id}:${c.updatedAt}`, kind: "reply", text: `No update from ${c.vendorName} for ${Math.floor((now - t) / day)} days on "${c.title}"`, href: "/recovery" });
    }
  }
  return out;
}
