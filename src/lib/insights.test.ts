import { describe, expect, it } from "vitest";
import { createSeedState } from "./data/seed";
import { auditAll } from "./data/selectors";
import { cashFlow, duplicateVendorPairs, vendorScorecard } from "./insights";
import type { Invoice, Vendor } from "./types";

const inv = (o: Partial<Invoice>): Invoice => ({
  id: "i", vendorId: "v", vendorName: "Acme", number: "1", date: "2026-11-01", dueDate: "2026-11-30", currency: "EUR", lineItems: [],
  subtotal: "100.00", discounts: "0.00", fees: "0.00", taxAmount: "0.00", total: "100.00", paymentStatus: "unpaid", source: "upload", createdAt: 1, ...o,
});
const vendor = (id: string, name: string): Vendor => ({ id, name, category: "Other", billing: "fixed", monitoring: { enabled: true, notify: true } });

describe("cashFlow", () => {
  it("groups unpaid bills by due date, per currency, leaving out paid, credit and simulated ones", () => {
    const flows = cashFlow([
      inv({ id: "a", dueDate: "2026-11-20" }), inv({ id: "b", dueDate: "2026-12-10", total: "50.00" }), inv({ id: "c", dueDate: "2027-01-20", total: "25.00" }),
      inv({ id: "d", dueDate: "2026-11-30", paymentStatus: "paid" }), inv({ id: "e", dueDate: "2026-11-30", isCredit: true }), inv({ id: "f", extraction: "mock" }),
      inv({ id: "g", currency: "USD", total: "999.00", dueDate: "2026-12-01" }), inv({ id: "h", dueDate: "", total: "5.00", medical: true }),
    ], "2026-11-26");
    expect(flows.map((f) => f.currency)).toEqual(["USD", "EUR"]); // never added together
    const eur = flows.find((f) => f.currency === "EUR")!;
    const by = Object.fromEntries(eur.buckets.map((b) => [b.bucket, b.total.toFixed(2)]));
    expect(by).toEqual({ overdue: "100.00", next30: "50.00", next60: "25.00", undated: "5.00" });
    expect(eur.buckets.find((b) => b.bucket === "undated")!.medical).toBe(1);
    expect(eur.total.toFixed(2)).toBe("180.00");
  });
  it("marks past due dates overdue", () => {
    expect(cashFlow([inv({ dueDate: "2026-11-01" })], "2026-11-26")[0].buckets[0].bucket).toBe("overdue");
  });
});

describe("vendorScorecard", () => {
  it("counts findings by what the person decided, and refuses to judge a vendor with too little history", () => {
    const s = createSeedState();
    const audits = auditAll(s);
    const byInvoice = Object.fromEntries(Object.entries(audits).map(([id, a]) => [id, a.findings]));
    const v = s.vendors.find((x) => x.name.startsWith("Northwind"))!;
    const card = vendorScorecard(v, s, byInvoice);
    expect(card.invoices).toBeGreaterThan(2);
    expect(card.findings).toBe(card.open + card.confirmed + card.dismissed);
    expect(card.summary).toMatch(/not confirmed errors/);
    const few = vendorScorecard(v, { ...s, invoices: s.invoices.filter((i) => i.vendorId === v.id).slice(0, 1) }, byInvoice);
    expect(few.summary).toMatch(/too few/);
  });
});

describe("duplicateVendorPairs", () => {
  it("suggests vendors that look like one company, and keeps the one with more invoices", () => {
    const vs = [vendor("1", "Acme Ltd"), vendor("2", "ACME Limited"), vendor("3", "Northwind Hosting"), vendor("4", "Northwnd Hosting"), vendor("5", "Orbit Workspace")];
    const invs = [inv({ id: "a", vendorId: "1" }), inv({ id: "b", vendorId: "2" }), inv({ id: "c", vendorId: "2" }), inv({ id: "d", vendorId: "3" })];
    const pairs = duplicateVendorPairs(vs, invs);
    expect(pairs.map((p) => [p.keep.id, p.drop.id])).toEqual([["2", "1"], ["3", "4"]]);
  });
  it("does not pair different companies with similar short names", () => {
    expect(duplicateVendorPairs([vendor("1", "Orbit"), vendor("2", "Orion")], [])).toEqual([]);
  });
});
