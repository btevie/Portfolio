import { describe, expect, it } from "vitest";
import { groupIntoLines, pdfLinesToText } from "./pdf-layout";
import { parseText } from "./parsers";

const LINES = [
  "Northwind Hosting BV",
  "INVOICE",
  "Invoice No: NW-2026-0099",
  "Invoice date: 12/11/2026",
  "Due date: 12/12/2026",
  "Description Qty Unit price Total",
  "Managed hosting (pro plan) 1 120.00 120.00",
  "Extra storage 50 GB 2 0.10 0.20",
  "Subtotal EUR 120.20",
  "VAT (21%) 25.24",
  "Total EUR 145.44",
];

describe("pdfLinesToText", () => {
  const text = pdfLinesToText(LINES);
  it("finds labelled fields and the vendor on the first line", () => {
    expect(text).toContain("Vendor: Northwind Hosting BV");
    expect(text).toContain("Invoice #: NW-2026-0099");
    expect(text).toContain("Tax rate: 21");
    expect(text).toContain("Total: 145.44");
  });
  it("turns table rows into pipe lines and ignores the header row", () => {
    expect(text).toContain("Managed hosting (pro plan) | 1 | 120.00 | 120.00");
    expect(text).toContain("Extra storage 50 GB | 2 | 0.10 | 0.20");
    expect(text).not.toMatch(/Description Qty/);
  });
  it("produces something parseText accepts, with the stated total kept for auditing", () => {
    const e = parseText(text, "EUR", "pdf");
    expect(e.method).toBe("pdf");
    expect(e.vendorName).toBe("Northwind Hosting BV");
    expect(e.lines).toHaveLength(2);
    expect(e.total).toBe("145.44");
    expect(e.currency).toBe("EUR");
    expect(e.date).toBe("12/11/2026");
    expect(e.dueDate).toBe("12/12/2026");
    expect(e.lowConfidence).toContain("date");
    expect(e.lowConfidence).toContain("dueDate");
  });
});

describe("groupIntoLines", () => {
  it("rebuilds visual lines top to bottom and left to right", () => {
    const l = groupIntoLines([
      { str: "Total", x: 10, y: 100, w: 30 }, { str: "65.34", x: 200, y: 100.5, w: 30 },
      { str: "Acme", x: 10, y: 700, w: 30 },
    ]);
    expect(l).toEqual(["Acme", "Total 65.34"]);
  });
});

describe("pdfLinesToText regressions", () => {
  it("does not read 'VAT' in 'Total incl. VAT' as a currency", () => {
    const t = pdfLinesToText(["Acme", "Total incl. VAT 145.44"]);
    expect(t).toContain("Total: 145.44");
    expect(t).not.toContain("Currency: VAT");
  });
  it("does not take a VAT registration number as the tax amount", () => {
    const t = pdfLinesToText(["Acme", "VAT No: DE123456789", "VAT (19%) 19.00"]);
    expect(t).toContain("Tax: 19.00");
    expect(t).not.toContain("123456789");
  });
  it("keeps 'Total excl. VAT' and 'Total VAT' out of the grand total", () => {
    const t = pdfLinesToText(["Acme", "Total excl. VAT 120.20", "Total VAT 25.24", "Total incl. VAT 145.44"]);
    expect(t).toContain("Subtotal: 120.20");
    expect(t).toContain("Tax: 25.24");
    expect(t).toContain("Total: 145.44");
  });
  it("keeps shipping and payment fee rows as items", () => {
    const t = pdfLinesToText(["Acme", "Shipping 1 5.00 5.00"]);
    expect(t).toContain("Shipping | 1 | 5.00 | 5.00");
  });
});

describe("pdfLinesToText totals", () => {
  it("keeps space-grouped amounts whole and prefers the final total over qualified ones", () => {
    const out = pdfLinesToText(["Total before discount 1 500,00", "Total EUR 1 234,56"]);
    expect(out).toContain("Total: 1234,56");
    expect(out).not.toContain("Total: 1500");
  });
});

describe("pdfLinesToText currency after a label", () => {
  it("finds EUR even when 'VAT' comes first", () => {
    expect(pdfLinesToText(["Acme", "Total incl. VAT EUR 145.44"])).toContain("Currency: EUR");
  });
});

describe("pdfLinesToText review fixes", () => {
  it("adds separate VAT lines and does not apply one rate to every item", () => {
    const t = pdfLinesToText(["Acme", "Widget 1 100.00 100.00", "Gadget 1 100.00 100.00", "VAT 9% 9.00", "VAT 21% 21.00", "Total 230.00"]);
    expect(t).toContain("Tax: 30.00");
    expect(t).not.toContain("Tax rate");
  });
  it("keeps a single VAT rate", () => {
    expect(pdfLinesToText(["Acme", "Widget 1 100.00 100.00", "VAT 21% 21.00", "Total 121.00"])).toContain("Tax rate: 21");
  });
  it("reads item rows that end with a currency code", () => {
    expect(pdfLinesToText(["Acme", "Hosting 1 10.00 10.00 EUR", "Total 10.00"])).toContain("Hosting | 1 | 10.00 | 10.00");
  });
  it("keeps items whose description starts with a keyword", () => {
    expect(pdfLinesToText(["Acme", "Shipping boxes 2 5.00 10.00", "Total 10.00"])).toContain("Shipping boxes | 2 | 5.00 | 10.00");
  });
});

describe("pdfLinesToText: totals and tax edge cases", () => {
  it("keeps a total that has the currency code after the amount", () => {
    expect(pdfLinesToText(["Acme BV", "Total 121.00 EUR"])).toContain("Total: 121.00");
    expect(pdfLinesToText(["Acme BV", "Total EUR 121.00"])).toContain("Total: 121.00");
    expect(pdfLinesToText(["Acme BV", "Total EUR 121.00"])).toContain("Currency: EUR");
  });
  it("does not take a running total as the final total, however the spaces fall", () => {
    const t = pdfLinesToText(["Acme BV", "Total so far 50.00", "Total 100.00"]);
    expect(t).toContain("Total: 100.00");
    expect(t).not.toContain("Total: 50.00");
  });
  it("adds comma-decimal tax lines correctly", () => {
    expect(pdfLinesToText(["Acme BV", "VAT 9% 9,00", "VAT 21% 21,00", "Total 130,00"])).toContain("Tax: 30.00");
  });
});

describe("pdfLinesToText signs", () => {
  it("keeps the minus sign on a space-grouped amount", () => {
    expect(pdfLinesToText(["Credit", "Total -1 234,56"])).toMatch(/Total[^\n]*-1234,56/);
    expect(pdfLinesToText(["Credit", "Total 1 234,56"])).not.toMatch(/Total[^\n]*-/);
  });
});
