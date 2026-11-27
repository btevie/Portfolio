import { describe, expect, it } from "vitest";
import { compareLines } from "./line-compare";
import { DEFAULT_CONFIG } from "./types";
import type { Invoice } from "../types";

const mk = (id: string, date: string, createdAt: number, lines: [string, string, string][], currency = "EUR"): Invoice => ({
  id, vendorId: "v", vendorName: "Acme", number: id, date, dueDate: date, currency,
  lineItems: lines.map(([description, quantity, unitPrice], i) => ({ id: `${id}-${i}`, description, quantity, unitPrice, total: unitPrice, kind: "item" as const })),
  subtotal: "0", discounts: "0", fees: "0", taxAmount: "0", total: "0", paymentStatus: "unpaid", source: "upload", createdAt,
});
const ctx = (invoices: Invoice[]) => ({ today: "2026-12-01", invoices, contractRates: [], config: DEFAULT_CONFIG });

describe("compareLines", () => {
  const old = mk("a", "2026-10-01", 1, [["Hosting", "1", "10.00"], ["Support", "1", "5.00"]]);
  const cur = mk("b", "2026-11-01", 2, [["hosting ", "1", "12.50"], ["Backup", "1", "3.00"]]);

  it("pairs only identical descriptions and reports exact decimal changes", () => {
    const r = compareLines(cur, ctx([old, cur]))!;
    expect(r.previous.id).toBe("a");
    expect(r.rows[0]).toMatchObject({ status: "changed", unitDiff: "2.50", unitPct: "25.0" });
    expect(r.rows[1].status).toBe("new");
    expect(r.rows[2]).toMatchObject({ status: "gone", description: "Support" });
  });

  it("returns null without earlier invoices and ignores other currencies", () => {
    expect(compareLines(old, ctx([old, cur]))).toBeNull();
    expect(compareLines(cur, ctx([mk("a", "2026-10-01", 1, [["Hosting", "1", "10"]], "USD"), cur]))).toBeNull();
  });
});
