import { describe, expect, it } from "vitest";
import { absoluteAmounts, isCreditDocument } from "./credit";
import { parseText } from "./parsers";

const CREDIT = `CREDIT NOTE
Vendor: Orbit Workspace
Invoice #: CN-1001
Invoice date: 2026-11-20
Due date: 2026-11-20
Currency: EUR
Refund for duplicate | 1 | -338.80 | -338.80
Total: -338.80`;

describe("credit notes", () => {
  it("is detected from a heading, a type line or a CSV cell, but not from a line item mentioning credit", () => {
    expect(isCreditDocument(CREDIT)).toBe(true);
    expect(isCreditDocument("Type: Credit Note\nVendor: X")).toBe(true);
    expect(isCreditDocument("description,type\nFoo,credit note")).toBe(true);
    expect(isCreditDocument("Vendor: X\nLess: credit note applied | 1 | 5.00 | 5.00")).toBe(false);
  });
  it("turns negative and bracketed amounts positive so the normal parser accepts them", () => {
    expect(absoluteAmounts("a | 1 | -338.80 | -338.80\nTotal: -338.80\nTax: (12.50)")).toBe("a | 1 | 338.80 | 338.80\nTotal: 338.80\nTax: 12.50");
    const e = parseText(absoluteAmounts(CREDIT), "EUR");
    expect(e.total).toBe("338.80");
    expect(e.lines[0].total).toBe("338.80");
  });
  it("leaves ordinary invoices alone", () => {
    expect(absoluteAmounts("Item - fee | 1 | 5.00 | 5.00")).toBe("Item - fee | 1 | 5.00 | 5.00");
  });
});
