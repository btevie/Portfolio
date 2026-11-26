import { auditInvoice, configFromSettings } from "../audit/engine";
import { D, Decimal, pct, sum } from "../audit/money";
import { netOf } from "../audit/history";
import { daysBetween, normalizeInvoiceNumber, parseISO } from "../audit/normalize";
import type { AuditResult } from "../audit/types";
import type { AppState, AuditFinding, Classification, Currency, Invoice, RecoveryRecord, Vendor } from "../types";

export const today = () => new Date().toISOString().slice(0, 10);

export type Audits = Record<string, AuditResult>;

export function auditAll(state: AppState): Audits {
  const config = configFromSettings(state.settings);
  const out: Audits = {};
  for (const inv of state.invoices) {
    out[inv.id] = auditInvoice(inv, {
      today: today(), invoices: state.invoices, contractRates: state.contractRates,
      vendor: state.vendors.find((v) => v.id === inv.vendorId), config,
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
  return (parseISO(b.date) ?? 0) - (parseISO(a.date) ?? 0) || b.createdAt - a.createdAt;
}

export interface DashboardMetrics {
  currency: Currency;
  invoicesChecked: number;
  potentialOvercharges: Decimal;
  excludedCurrencies: number;
  recovered: Decimal;
  needsReview: Invoice[];
  monthly: { label: string; total: number }[];
}

export function dashboardMetrics(state: AppState, audits: Audits): DashboardMetrics {
  const currency = state.settings.currency;
  const open = openFindings(state, audits);
  const inCur = (inv?: Invoice) => inv?.currency === currency;
  const byId = new Map(state.invoices.map((i) => [i.id, i]));
  const potential = sum(open.filter((f) => inCur(byId.get(f.invoiceId))).map((f) => D(f.amountAtRisk)));
  const excluded = open.filter((f) => !inCur(byId.get(f.invoiceId)) && D(f.amountAtRisk).gt(0)).length;
  const recovered = sum(state.recovery.filter((r) => r.status === "recovered" && r.currency === currency).map((r) => D(r.amount)));
  const needsReview = state.invoices
    .filter((i) => effectiveClassification(state, audits[i.id]) !== "CLEAR")
    .sort(invoiceSort);

  // last 6 calendar months ending at the latest invoice month
  const latest = state.invoices.reduce((m, i) => Math.max(m, parseISO(i.date) ?? 0), 0) || Date.now();
  const end = new Date(latest);
  const months: { key: string; label: string; total: Decimal }[] = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - k, 1));
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString("en", { month: "short", timeZone: "UTC" }), total: D(0) });
  }
  const seen = new Set<string>();
  for (const i of state.invoices.filter((x) => x.currency === currency)) {
    const key = `${i.vendorId}|${normalizeInvoiceNumber(i.number)}`; // count re-sent copies once
    if (seen.has(key)) continue;
    seen.add(key);
    const m = months.find((x) => x.key === i.date.slice(0, 7));
    if (m) m.total = m.total.plus(D(i.total));
  }
  return {
    currency, invoicesChecked: state.invoices.length, potentialOvercharges: potential, excludedCurrencies: excluded,
    recovered, needsReview, monthly: months.map((m) => ({ label: m.label, total: m.total.toNumber() })),
  };
}

export interface VendorStats {
  vendor: Vendor;
  invoices: Invoice[]; // newest first, all copies
  unique: Invoice[]; // oldest first, re-sends removed
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
    const all = state.invoices.filter((i) => i.vendorId === vendor.id);
    const seen = new Set<string>();
    const unique = [...all].sort((a, b) => (parseISO(a.date) ?? 0) - (parseISO(b.date) ?? 0) || a.createdAt - b.createdAt)
      .filter((i) => { const k = normalizeInvoiceNumber(i.number); if (seen.has(k)) return false; seen.add(k); return true; });
    const latest = unique[unique.length - 1] ?? null;
    const prior = unique.slice(0, -1);
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
      : unique.length < 3 ? "Building baseline" : "Stable";
    return {
      vendor, invoices: [...all].sort(invoiceSort), unique, invoiceCount: all.length, average, latest, changePct,
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
  if (!totals.every((t) => t.minus(avg).abs().div(avg).lte("0.25"))) return null;
  const last = parseISO(unique[unique.length - 1].date)!;
  const next = new Date(last + 30 * 86_400_000).toISOString().slice(0, 10);
  return { monthly: D(unique[unique.length - 1].total), nextExpected: next };
}

export interface RecoveryStats {
  potential: Decimal; disputed: Decimal; recovered: Decimal; rate: number | null; resolved: number; won: number;
}

export function recoveryStats(records: RecoveryRecord[], currency: Currency): RecoveryStats {
  const mine = records.filter((r) => r.currency === currency);
  const amt = (st: string[]) => sum(mine.filter((r) => st.includes(r.status)).map((r) => D(r.amount)));
  const won = mine.filter((r) => r.status === "recovered" || r.status === "credit_issued").length;
  const resolved = won + mine.filter((r) => r.status === "dismissed").length;
  return {
    potential: amt(["flagged", "disputed", "vendor_responded"]),
    disputed: amt(["disputed", "vendor_responded"]),
    recovered: amt(["recovered"]),
    rate: resolved ? Math.round((won / resolved) * 100) : null,
    resolved, won,
  };
}
