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
