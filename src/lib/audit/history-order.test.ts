import { describe, expect, it } from "vitest";
import { priorInvoices } from "./history";
import type { Invoice } from "../types";

const mk = (id: string, number: string, date: string, total: string, createdAt: number): Invoice => ({
  id, vendorId: "v", vendorName: "Acme", number, date, dueDate: date, currency: "EUR", subtotal: total, total, taxAmount: "0.00", taxRate: "0", discounts: "0.00", fees: "0.00",
  lineItems: [], paymentStatus: "paid", source: "upload", createdAt, notes: "",
} as unknown as Invoice);

describe("priorInvoices keeps chronological order when a re-sent copy replaces its original", () => {
  it("A (Jan 1), B (Jan 3), copy of A (Jan 5) -> [B, A-copy]", () => {
    const a = mk("a", "INV-1", "2026-01-01", "100.00", 1), b = mk("b", "INV-2", "2026-01-03", "200.00", 2), a2 = mk("a2", "INV-1", "2026-01-05", "100.00", 3);
    const cur = mk("cur", "INV-3", "2026-02-01", "150.00", 4);
    const prior = priorInvoices(cur, { invoices: [a, b, a2, cur], today: "2026-02-02", contractRates: [], config: {} } as never);
    expect(prior.map((i) => i.id)).toEqual(["b", "a2"]);
  });
});
