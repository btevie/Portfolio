import { D, Decimal } from "./audit/money";
import { daysBetween, normalizeVendor, parseISO } from "./audit/normalize";
import { isSimulated } from "./evidence";
import type { AppState, AuditFinding, Currency, Invoice, Vendor } from "./types";

/* ---------- Cash flow: what is due, and when ---------- */

export type FlowBucket = "overdue" | "next30" | "next60" | "next90" | "later" | "undated";
export const FLOW_LABEL: Record<FlowBucket, string> = {
  overdue: "Overdue", next30: "Next 30 days", next60: "31–60 days", next90: "61–90 days", later: "Later", undated: "No due date",
};
export const FLOW_ORDER: FlowBucket[] = ["overdue", "next30", "next60", "next90", "later", "undated"];

export interface CashFlowBucket { bucket: FlowBucket; invoices: Invoice[]; total: Decimal; medical: number }
export interface CashFlow { currency: Currency; buckets: CashFlowBucket[]; total: Decimal }

/**
 * Unpaid bills grouped by when they fall due, one table per currency (Overbill never converts). Credit notes and simulated
 * invoices are left out. Totals are what the bills say, not what you will pay: credits and disputes are not netted off.
 */
export function cashFlow(invoices: Invoice[], todayIso: string): CashFlow[] {
  const today = parseISO(todayIso);
  const unpaid = invoices.filter((i) => i.paymentStatus !== "paid" && !i.isCredit && !isSimulated(i));
  const byCurrency = new Map<Currency, Invoice[]>();
  for (const i of unpaid) byCurrency.set(i.currency, [...(byCurrency.get(i.currency) ?? []), i]);
  const bucketOf = (i: Invoice): FlowBucket => {
    const due = parseISO(i.dueDate);
    if (due === null || today === null) return "undated";
    const d = daysBetween(today, due);
    return d < 0 ? "overdue" : d <= 30 ? "next30" : d <= 60 ? "next60" : d <= 90 ? "next90" : "later";
  };
  return [...byCurrency.entries()].map(([currency, list]) => {
    const buckets = FLOW_ORDER.map((bucket) => {
      const inB = list.filter((i) => bucketOf(i) === bucket).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      return { bucket, invoices: inB, total: inB.reduce((t, i) => t.plus(D(i.total)), D(0)), medical: inB.filter((i) => i.medical).length };
    }).filter((b) => b.invoices.length > 0);
    return { currency, buckets, total: list.reduce((t, i) => t.plus(D(i.total)), D(0)) };
  }).sort((a, b) => b.total.comparedTo(a.total));
}

/* ---------- Vendor scorecard ---------- */

export interface Scorecard {
  invoices: number;
  findings: number;
  open: number;
  /** Findings the person agreed were errors, and ones they dismissed as expected. Only the person can confirm. */
  confirmed: number;
  dismissed: number;
  /** Share of this vendor's invoices with at least one finding of any status, 0–100. */
  flaggedInvoicesPct: number;
  /** Plain-language reading with the numbers it rests on. Never a verdict on the vendor. */
  summary: string;
}

export function vendorScorecard(vendor: Vendor, state: AppState, findingsByInvoice: Record<string, AuditFinding[]>): Scorecard {
  const mine = state.invoices.filter((i) => i.vendorId === vendor.id && !i.isCredit && !isSimulated(i));
  const all = mine.flatMap((i) => findingsByInvoice[i.id] ?? []);
  const status = (f: AuditFinding) => state.decisions[f.id] ?? "open";
  const confirmed = all.filter((f) => status(f) === "confirmed").length;
  const dismissed = all.filter((f) => status(f) === "dismissed").length;
  const open = all.length - confirmed - dismissed;
  const flagged = mine.filter((i) => (findingsByInvoice[i.id] ?? []).length > 0).length;
  const pct = mine.length ? Math.round((flagged / mine.length) * 100) : 0;
  const summary = mine.length < 3
    ? `Only ${mine.length} invoice${mine.length === 1 ? "" : "s"} so far: too few to say anything about this vendor.`
    : `${flagged} of ${mine.length} invoices had a possible issue (${pct}%). You confirmed ${confirmed} and dismissed ${dismissed}; ${open} still open. Possible issues are not confirmed errors.`;
  return { invoices: mine.length, findings: all.length, open, confirmed, dismissed, flaggedInvoicesPct: pct, summary };
}

/* ---------- Possible duplicate vendors ---------- */

const lev = (a: string, b: string): number => {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};

export interface VendorPair { keep: Vendor; drop: Vendor; reason: string }

/** Vendors that are probably one company written two ways ("Acme Ltd" / "ACME Limited", "Northwind Hosting" / "Northwnd Hosting"). Suggestions only: merging is the person's call. */
export function duplicateVendorPairs(vendors: Vendor[], invoices: Invoice[]): VendorPair[] {
  const count = (v: Vendor) => invoices.filter((i) => i.vendorId === v.id).length;
  const out: VendorPair[] = [];
  for (let x = 0; x < vendors.length; x++) {
    for (let y = x + 1; y < vendors.length; y++) {
      const a = vendors[x], b = vendors[y];
      const ka = normalizeVendor(a.name), kb = normalizeVendor(b.name);
      if (!ka || !kb) continue;
      let reason = "";
      if (ka === kb) reason = "Same name apart from punctuation or company suffix";
      else if (Math.min(ka.length, kb.length) >= 6 && lev(ka, kb) <= Math.max(1, Math.floor(Math.min(ka.length, kb.length) / 8))) reason = "Names differ by a letter or two";
      else if (Math.min(ka.length, kb.length) >= 8 && (ka.startsWith(`${kb} `) || kb.startsWith(`${ka} `))) reason = "One name is the other plus extra words";
      if (!reason) continue;
      const [keep, drop] = count(a) >= count(b) ? [a, b] : [b, a];
      out.push({ keep, drop, reason });
    }
  }
  return out;
}
