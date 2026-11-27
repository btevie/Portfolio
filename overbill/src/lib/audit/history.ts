import type { Invoice } from "../types";
import { daysBetween, normalizeInvoiceNumber, normalizeVendor, parseISO, subtractMonths } from "./normalize";
import { D, Decimal, pct, round2, str2, sum } from "./money";
import type { AuditContext, HistoricalComparison } from "./types";

export const DUPLICATE_COPY_WINDOW_DAYS = 5;

/** Two records are confidently the same invoice copy only when number, total and dates align. */
export function isDuplicateCopy(a: Invoice, b: Invoice): boolean {
  const number = normalizeInvoiceNumber(a.number);
  if (!number || normalizeInvoiceNumber(b.number) !== number || normalizeVendor(a.vendorName) !== normalizeVendor(b.vendorName)
    || a.currency !== b.currency || !D(a.total).eq(D(b.total))) return false;
  const aDate = parseISO(a.date), bDate = parseISO(b.date);
  return aDate !== null && bDate !== null && Math.abs(daysBetween(aDate, bDate)) <= DUPLICATE_COPY_WINDOW_DAYS;
}

/**
 * Net pricing: what the vendor charged before fees and tax, rebuilt from quantity × unit price so an
 * arithmetic slip is reported once (by the arithmetic rule) instead of again as a "price increase".
 */
export const netOf = (i: Invoice): Decimal =>
  sum(i.lineItems.filter((l) => l.kind === "item").map((l) => round2(D(l.quantity).times(D(l.unitPrice))))).minus(D(i.discounts));

export function isEarlier(other: Invoice, inv: Invoice): boolean {
  const a = parseISO(other.date), b = parseISO(inv.date);
  if (a !== null && b !== null && a !== b) return a < b;
  return other.createdAt < inv.createdAt || (other.createdAt === inv.createdAt && other.id < inv.id);
}

/** Prior invoices from the same vendor *in the same currency* (amounts are never compared across currencies), oldest → newest, with re-sent duplicates counted once. */
export function priorInvoices(inv: Invoice, ctx: AuditContext): Invoice[] {
  const vendor = normalizeVendor(inv.vendorName);
  const seen = new Map<string, Invoice[]>();
  const out: Invoice[] = [];
  const candidates = ctx.invoices
    .filter((o) => o.id !== inv.id && normalizeVendor(o.vendorName) === vendor && o.currency === inv.currency && isEarlier(o, inv))
    .sort((a, b) => (parseISO(a.date) ?? 0) - (parseISO(b.date) ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const o of candidates) {
    const number = normalizeInvoiceNumber(o.number);
    // A blank or unreadable number cannot prove that two invoices are copies.
    if (number) {
      const copies = seen.get(number) ?? [];
      const duplicateIndex = copies.findIndex((prior) => isDuplicateCopy(prior, o));
      if (duplicateIndex >= 0) {
        const old = copies[duplicateIndex];
        const outputIndex = out.indexOf(old);
        if (outputIndex >= 0) out[outputIndex] = o;
        copies[duplicateIndex] = o;
        continue;
      }
      copies.push(o);
      seen.set(number, copies);
    }
    out.push(o);
  }
  return out;
}

const avg = (vals: Decimal[]): Decimal | null => (vals.length ? sum(vals).div(vals.length) : null);

export function compareToHistory(inv: Invoice, ctx: AuditContext): HistoricalComparison {
  const prior = priorInvoices(inv, ctx);
  const current = netOf(inv);
  const t = parseISO(inv.date);
  const within = (months: number) =>
    t === null ? [] : prior.filter((p) => { const pt = parseISO(p.date); return pt !== null && pt >= subtractMonths(t, months); });
  const previous = prior.length ? netOf(prior[prior.length - 1]) : null;
  const average = avg(prior.map(netOf));
  const avg3m = avg(within(3).map(netOf));
  const avg6m = avg(within(6).map(netOf));
  const variable = ctx.vendor?.billing === "variable";
  const baseline = variable ? (avg6m ?? average) : previous;
  const baselineLabel = variable ? "rolling 6-month average" : "previous invoice";
  const reliable = prior.length >= ctx.config.minHistory;
  const absDiff = baseline ? current.minus(baseline) : null;
  return {
    sampleSize: prior.length,
    reliable,
    current: str2(current),
    previous: previous ? str2(previous) : null,
    average: average ? str2(average) : null,
    avg3m: avg3m ? str2(avg3m) : null,
    avg6m: avg6m ? str2(avg6m) : null,
    baselineLabel,
    baseline: baseline ? str2(baseline) : null,
    absDiff: absDiff ? str2(absDiff) : null,
    pctDiff: baseline && absDiff ? pct(absDiff, baseline).toDecimalPlaces(1).toFixed(1) : null,
  };
}
