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
});
