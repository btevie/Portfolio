import { describe, expect, it } from "vitest";
import { createSeedState } from "../data/seed";
import type { ContractRate, Invoice, InvoiceLineItem, Vendor } from "../types";
import { auditInvoice, configFromSettings } from "./engine";
import { compareToHistory } from "./history";
import { D } from "./money";
import { normalizeInvoiceNumber, normalizeVendor, parseISO, subtractMonths } from "./normalize";
import { DEFAULT_CONFIG, type AuditConfig } from "./types";

const vendor: Vendor = { id: "v", name: "Acme Ltd", category: "Software", billing: "fixed", monitoring: { enabled: true, notify: true } };
let n = 0;

function line(description: string, qty: string, price: string, extra: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return { id: `l${n++}`, description, quantity: qty, unitPrice: price, total: D(qty).times(D(price)).toFixed(2), kind: "item", taxRate: "21", ...extra };
}

function invoice(o: Partial<Invoice> & { lines?: InvoiceLineItem[] } = {}): Invoice {
  const lines = o.lines ?? [line("Plan", "1", "100.00")];
  const sub = lines.filter((l) => l.kind === "item").reduce((a, l) => a.plus(D(l.total)), D(0));
  const fees = lines.filter((l) => l.kind === "fee").reduce((a, l) => a.plus(D(l.total)), D(0));
  const tax = sub.plus(fees).times("0.21").toDecimalPlaces(2);
  const { lines: _l, ...rest } = o;
  void _l;
  return {
    id: `i${n++}`, vendorId: vendor.id, vendorName: "Acme Ltd", number: `INV-${n}`, date: "2026-10-01", dueDate: "2026-10-31", currency: "EUR",
    lineItems: lines, subtotal: sub.toFixed(2), discounts: "0.00", fees: fees.toFixed(2), taxAmount: tax.toFixed(2), taxRate: "21",
    total: sub.plus(fees).plus(tax).toFixed(2), paymentStatus: "unpaid", source: "upload", createdAt: n, ...rest,
  };
}

const ctx = (invoices: Invoice[] = [], extra: { rates?: ContractRate[]; vendor?: Vendor; config?: Partial<AuditConfig> } = {}) => ({
  today: "2026-11-26", invoices, contractRates: extra.rates ?? [], vendor: extra.vendor ?? vendor, config: { ...DEFAULT_CONFIG, ...extra.config },
});
const ids = (inv: Invoice, c = ctx([inv])) => auditInvoice(inv, c).findings.map((f) => f.ruleId);

/** Monthly invoices Apr.. with a 30-day term, oldest first. */
function history(count = 6, price = "100.00"): Invoice[] {
  return Array.from({ length: count }, (_, i) => {
    const m = String(4 + i).padStart(2, "0");
    return invoice({ id: `h${i}-${n}`, number: `H-${i + 1}`, date: `2026-${m}-01`, dueDate: `2026-${m}-31`.replace(/-(04|06|09)-31/, "-$1-30"), lines: [line("Plan", "1", price)], createdAt: i + 1 });
  });
}

describe("arithmetic", () => {
  it("passes a consistent invoice", () => expect(ids(invoice())).toEqual([]));
  it("flags quantity × price ≠ line total", () => {
    const inv = invoice({ lines: [line("Seats", "12", "9.50", { total: "124.00" })] });
    const f = auditInvoice(inv, ctx([inv])).findings.find((x) => x.ruleId === "arithmetic")!;
    expect(f.classification).toBe("LIKELY_ERROR");
    expect(f.expected).toContain("114.00");
    expect(f.actual).toContain("124.00");
    expect(f.confidence).toBe("high");
  });
  it("tolerates a one-cent rounding difference", () => {
    const inv = invoice({ lines: [line("Metered", "3", "0.3333", { total: "1.00" })] });
    expect(ids(inv)).not.toContain("arithmetic");
  });
  it("flags line sums that differ from the subtotal", () => {
    expect(ids(invoice({ subtotal: "105.00" }))).toContain("arithmetic");
  });
  it("flags a wrong grand total and reports the exact difference", () => {
    const inv = { ...invoice(), total: "130.00" };
    const f = auditInvoice(inv, ctx([inv])).findings.find((x) => x.id.endsWith(":total"))!;
    expect(f.amountAtRisk).toBe("9.00");
  });
  it("uses decimal-safe math (0.1 + 0.2)", () => {
    const inv = invoice({ lines: [line("A", "1", "0.10"), line("B", "1", "0.20")], subtotal: "0.30", taxAmount: "0.06", total: "0.36" });
    expect(ids(inv)).toEqual([]);
  });
});

describe("tax", () => {
  it("flags tax that does not match the stated rate", () => {
    expect(ids(invoice({ taxAmount: "30.00", total: "130.00" }))).toContain("tax");
  });
  it("supports multiple rates on one invoice", () => {
    const lines = [line("Standard", "1", "100.00", { taxRate: "21" }), line("Reduced", "1", "100.00", { taxRate: "9" })];
    const ok = invoice({ lines, taxRate: undefined, taxAmount: "30.00", total: "230.00" });
    expect(ids(ok)).toEqual([]);
    expect(ids({ ...ok, taxAmount: "42.00", total: "242.00" })).toContain("tax");
  });
  it("applies discounts before tax", () => {
    expect(ids(invoice({ discounts: "10.00", taxAmount: "18.90", total: "108.90" }))).toEqual([]);
  });
  it("does nothing when no rate is stated", () => {
    const inv = invoice({ lines: [line("x", "1", "10.00", { taxRate: undefined })], taxRate: undefined, taxAmount: "5.00", total: "15.00" });
    expect(ids(inv)).not.toContain("tax");
  });
});

describe("duplicate invoices", () => {
  const original = invoice({ id: "orig", number: "INV-0042", date: "2026-10-01", createdAt: 1 });
  it("detects an exact duplicate after normalising number and vendor", () => {
    const copy = invoice({ id: "copy", number: "inv 42", vendorName: "ACME Ltd.", date: "2026-10-03", createdAt: 2 });
    const r = auditInvoice(copy, ctx([original, copy]));
    expect(r.findings[0].ruleId).toBe("duplicate_invoice");
    expect(r.findings[0].classification).toBe("LIKELY_ERROR");
    expect(r.classification).toBe("LIKELY_ERROR");
  });
  it("does not flag the original", () => {
    const copy = invoice({ id: "copy", number: "INV-0042", createdAt: 2 });
    expect(auditInvoice(original, ctx([original, copy])).findings.filter((f) => f.ruleId === "duplicate_invoice")).toEqual([]);
  });
  it("treats same number + different total as a review, not an error", () => {
    const amended = invoice({ id: "am", number: "INV-0042", lines: [line("Plan", "1", "120.00")], createdAt: 2 });
    const f = auditInvoice(amended, ctx([original, amended])).findings.find((x) => x.ruleId === "duplicate_invoice")!;
    expect(f.classification).toBe("REVIEW_NEEDED");
  });
  it("flags same total within days under a different number as a low-confidence near-duplicate", () => {
    const near = invoice({ id: "near", number: "INV-9999", date: "2026-10-03", createdAt: 2 });
    const f = auditInvoice(near, ctx([original, near])).findings.find((x) => x.ruleId === "duplicate_invoice")!;
    expect(f.classification).toBe("REVIEW_NEEDED");
    expect(f.confidence).toBe("low");
  });
  it("does not flag identical monthly amounts a month apart", () => {
    const h = history(3);
    expect(ids(h[2], ctx(h))).not.toContain("duplicate_invoice");
  });
  it("normalisers behave", () => {
    expect(normalizeInvoiceNumber("INV-0042")).toBe("42");
    expect(normalizeInvoiceNumber("#42")).toBe("42");
    expect(normalizeVendor("Acme, Ltd.")).toBe("acme");
    expect(normalizeVendor("Acme B.V.")).toBe(normalizeVendor("Acme BV"));
  });
});

describe("duplicate line items", () => {
  it("flags identical repeated lines", () => {
    expect(ids(invoice({ lines: [line("Setup", "1", "50.00"), line("Setup", "1", "50.00")] }))).toContain("duplicate_line");
  });
  it("does not flag repeated descriptions with different quantities", () => {
    expect(ids(invoice({ lines: [line("Consulting hours", "2", "80.00"), line("Consulting hours", "5", "80.00")] }))).not.toContain("duplicate_line");
  });
});

describe("dates", () => {
  it("flags due date before invoice date", () => expect(ids(invoice({ dueDate: "2026-09-01" }))).toContain("dates"));
  it("flags impossible dates", () => expect(ids(invoice({ date: "2026-02-30" }))).toContain("dates"));
  it("flags future-dated invoices as review only", () => {
    const inv = invoice({ date: "2026-12-20", dueDate: "2027-01-20" });
    const f = auditInvoice(inv, ctx([inv])).findings.find((x) => x.ruleId === "dates")!;
    expect(f.classification).toBe("REVIEW_NEEDED");
  });
  it("flags changed payment terms against a consistent history", () => {
    const h = history(4);
    const inv = invoice({ id: "t", number: "NEW", date: "2026-10-01", dueDate: "2026-10-08", createdAt: 99 });
    expect(ids(inv, ctx([...h, inv]))).toContain("dates");
  });
});

describe("historical price comparison", () => {
  it("clamps rolling history cutoffs to the last day of shorter months", () => {
    expect(new Date(subtractMonths(parseISO("2024-03-31")!, 1)).toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(new Date(subtractMonths(parseISO("2026-03-31")!, 1)).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
  const run = (price: string, opts: Parameters<typeof ctx>[1] = {}) => {
    const h = history(6);
    const cur = invoice({ id: "cur", number: "CUR", date: "2026-10-01", dueDate: "2026-10-31", lines: [line("Plan", "1", price)], createdAt: 100 });
    return auditInvoice(cur, ctx([...h, cur], opts));
  };
  it("ignores < 5%", () => expect(run("103.00").findings).toEqual([]));
  it("5–10% is a low-severity review", () => {
    const f = run("107.00").findings[0];
    expect([f.ruleId, f.severity, f.classification]).toEqual(["price_history", "low", "REVIEW_NEEDED"]);
  });
  it(">10% is medium and >20% is high; never LIKELY_ERROR", () => {
    expect(run("115.00").findings[0].severity).toBe("medium");
    const high = run("125.00").findings[0];
    expect(high.severity).toBe("high");
    expect(high.classification).toBe("REVIEW_NEEDED");
  });
  it("explains confidence in the change separately from confidence it is an error", () => {
    const f = run("115.00").findings[0];
    expect(f.confidence).toBe("high");
    expect(f.confidenceReason).toMatch(/identical/);
    expect(f.uncertainty).toMatch(/changed their pricing/);
  });
  it("widens thresholds for variable vendors", () => {
    expect(run("114.00", { vendor: { ...vendor, billing: "variable" } }).findings).toEqual([]);
  });
  it("is configurable via sensitivity", () => {
    expect(run("104.00", { config: { sensitivityScale: 0.5 } }).findings.length).toBe(1);
  });
  it("computes previous, average and rolling baselines", () => {
    const h = history(6);
    const cur = invoice({ id: "cur", number: "CUR", date: "2026-10-01", lines: [line("Plan", "1", "115.00")], createdAt: 100 });
    const c = compareToHistory(cur, ctx([...h, cur]));
    expect(c).toMatchObject({ previous: "100.00", average: "100.00", avg3m: "100.00", avg6m: "100.00", pctDiff: "15.0", absDiff: "15.00", reliable: true });
  });
  it("reports insufficient history instead of guessing", () => {
    const h = history(1);
    const cur = invoice({ id: "cur", number: "CUR", date: "2026-10-01", lines: [line("Plan", "1", "300.00")], createdAt: 100 });
    const r = auditInvoice(cur, ctx([...h, cur]));
    expect(r.comparison.reliable).toBe(false);
    expect(r.findings.filter((f) => f.ruleId === "price_history")).toEqual([]);
  });
});

describe("contract rates and expected amounts", () => {
  const rate: ContractRate = { id: "r1", vendorId: "v", match: "consulting", unitPrice: "80.00", unit: "hour", currency: "EUR" };
  it("flags a unit price above the agreed rate as LIKELY_ERROR", () => {
    const inv = invoice({ lines: [line("Consulting hours", "10", "90.00")] });
    const f = auditInvoice(inv, ctx([inv], { rates: [rate] })).findings.find((x) => x.ruleId === "contract_rate")!;
    expect(f.classification).toBe("LIKELY_ERROR");
    expect(f.amountAtRisk).toBe("121.00"); // 10 h × €10 over, plus 21% tax
  });
  it("accepts the agreed rate or lower", () => {
    const inv = invoice({ lines: [line("Consulting hours", "10", "75.00")] });
    expect(ids(inv, ctx([inv], { rates: [rate] }))).not.toContain("contract_rate");
  });
  it("flags a total that differs from the user's expected amount as review only", () => {
    const inv = invoice();
    const f = auditInvoice(inv, ctx([inv], { vendor: { ...vendor, expectedAmount: "100.00" } })).findings.find((x) => x.ruleId === "contract_rate")!;
    expect(f.classification).toBe("REVIEW_NEEDED");
  });
});

describe("unexpected fees", () => {
  const h = history(3);
  it("flags a new fee as an anomaly, not an error", () => {
    const cur = invoice({ id: "cur", number: "CUR", date: "2026-10-01", lines: [line("Plan", "1", "100.00"), line("Admin fee", "1", "7.50", { kind: "fee" })], createdAt: 100 });
    const f = auditInvoice(cur, ctx([...h, cur])).findings.find((x) => x.ruleId === "unexpected_fee")!;
    expect(f.classification).toBe("REVIEW_NEEDED");
  });
  it("ignores fees that appeared before", () => {
    const withFee = (id: string, number: string, date: string, createdAt: number) =>
      invoice({ id, number, date, createdAt, lines: [line("Plan", "1", "100.00"), line("Static IP", "1", "5.00", { kind: "fee" })] });
    const prev = withFee("p", "P1", "2026-08-01", 1), cur = withFee("c", "C1", "2026-09-01", 2);
    expect(ids(cur, ctx([prev, cur]))).not.toContain("unexpected_fee");
  });
  it("makes no claim without history", () => {
    const cur = invoice({ lines: [line("Plan", "1", "100.00"), line("Admin fee", "1", "7.50", { kind: "fee" })] });
    expect(ids(cur)).not.toContain("unexpected_fee");
  });
});

describe("classification & demo story", () => {
  const s = createSeedState();
  const audit = (id: string) => {
    const inv = s.invoices.find((i) => i.id === id)!;
    return auditInvoice(inv, { today: "2026-11-26", invoices: s.invoices, contractRates: s.contractRates, vendor: s.vendors.find((v) => v.id === inv.vendorId), config: configFromSettings(s.settings) });
  };
  it("seed has ≥5 vendors and ≥15 invoices", () => {
    expect(s.vendors.length).toBeGreaterThanOrEqual(5);
    expect(s.invoices.length).toBeGreaterThanOrEqual(15);
  });
  it.each([
    ["inv-orbit-resend", "LIKELY_ERROR", "duplicate_invoice"],
    ["inv-stackly-4", "LIKELY_ERROR", "arithmetic"],
    ["inv-meridian-4", "LIKELY_ERROR", "contract_rate"],
    ["inv-northwind-7", "REVIEW_NEEDED", "price_history"],
    ["inv-brightline-5", "REVIEW_NEEDED", "unexpected_fee"],
  ] as const)("%s → %s via %s", (id, cls, rule) => {
    const r = audit(id);
    expect(r.classification).toBe(cls);
    expect(r.findings.map((f) => f.ruleId)).toEqual([rule]);
  });
  it("legitimate variable-cost invoice is CLEAR", () => expect(audit("inv-lumen-7").classification).toBe("CLEAR"));
  it("a plain historical invoice is CLEAR", () => expect(audit("inv-brightline-4").findings).toEqual([]));
  it("every finding carries all required fields", () => {
    for (const inv of s.invoices) for (const f of audit(inv.id).findings) {
      for (const k of ["severity", "explanation", "expected", "actual", "difference", "confidence", "confidenceReason", "uncertainty", "recommendedAction"] as const) expect(f[k], `${f.id}.${k}`).toBeTruthy();
      expect(f.evidence.length).toBeGreaterThan(0);
    }
  });
  it("disabled rules do not run", () => {
    const inv = s.invoices.find((i) => i.id === "inv-stackly-4")!;
    const r = auditInvoice(inv, { today: "2026-11-26", invoices: s.invoices, contractRates: [], vendor: undefined, config: { ...DEFAULT_CONFIG, disabledRules: ["arithmetic"] } });
    expect(r.findings).toEqual([]);
  });
});
