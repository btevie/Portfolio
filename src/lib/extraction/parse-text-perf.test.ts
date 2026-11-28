import { describe, expect, it } from "vitest";
import { parseText } from "./parsers";

describe("parseText performance and key/value parsing", () => {
  it("does not backtrack quadratically on a long run of spaces", () => {
    const line = "a" + " ".repeat(50_000) + "b";
    const t0 = performance.now();
    try { parseText(line, "EUR"); } catch { /* no line items is expected */ }
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("still reads spaced and equals-sign key/value headers", () => {
    const e = parseText("Vendor : Acme Co\nInvoice = A-1\nDate: 2026-01-05\nWidget | 2 | 10.00 | 20.00\nTotal: 20.00", "EUR");
    expect(e.vendorName).toBe("Acme Co");
    expect(e.number).toBe("A-1");
  });

  it("does not backtrack on parentheses followed by a long run of spaces", async () => {
    const { absoluteAmounts } = await import("./credit");
    for (const text of ["(" + " ".repeat(20_000) + "x", "( -" + " ".repeat(20_000) + "x", "(" + "\t ".repeat(10_000) + "1"]) {
      const t0 = performance.now();
      absoluteAmounts(text);
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });
});
