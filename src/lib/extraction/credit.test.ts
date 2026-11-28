import { describe, expect, it } from "vitest";
import { absoluteAmounts, isCreditDocument, keepCreditSignal } from "./credit";

describe("credit note normalisation", () => {
  it("strips minus signs from quoted CSV cells and brackets", () => {
    expect(absoluteAmounts('a,"-12.50",(3.00)')).toBe('a,"12.50",3.00');
  });
  it("finds a credit type in a row after a quoted multi-line cell", () => {
    const csv = 'description,quantity,unit_price,type\n"Line one\nstill one",1,5,invoice\nRefund,1,5,credit note\n';
    expect(isCreditDocument(csv)).toBe(true);
    expect(isCreditDocument('description,type\nA,invoice\n')).toBe(false);
  });
  it("does not backtrack badly on long runs of spaces", () => {
    const t0 = Date.now();
    absoluteAmounts(`(1${" ".repeat(20000)}x`);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("credit detection ignores quoted CSV content and trusts the type column", () => {
  it("a quoted cell that looks like a heading does not make an invoice a credit note", () => {
    const csv = 'type,description,quantity,unit_price\ninvoice,"Service\nCredit note\nhandling",1,10.00';
    expect(isCreditDocument(csv)).toBe(false);
    expect(isCreditDocument("type,description,quantity,unit_price\ncredit_note,Refund,1,10.00")).toBe(true);
    expect(isCreditDocument("Credit note\nVendor: Acme")).toBe(true);
  });
});

describe("keepCreditSignal", () => {
  it("keeps a credit heading that layout reshaping dropped, and leaves ordinary invoices alone", () => {
    expect(isCreditDocument(keepCreditSignal("Credit invoice\nTotal 10.00", "Total 10.00"))).toBe(true);
    expect(keepCreditSignal("Invoice\nTotal 10.00", "Total 10.00")).toBe("Total 10.00");
    expect(keepCreditSignal("Credit note\nTotal 10.00", "Credit note\nTotal 10.00")).toBe("Credit note\nTotal 10.00");
  });
});

describe("a lone type label is not a CSV", () => {
  it("still sees a Credit invoice heading below a plain-text Type line", () => {
    expect(isCreditDocument("Type\nCredit invoice\nWidget | 1 | 10.00 | 10.00")).toBe(true);
  });
});
