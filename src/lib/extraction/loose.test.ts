import { describe, expect, it } from "vitest";
import { looseAmount } from "./loose";
import { parseText } from "./parsers";

const coffee = "Bean There Coffee Co\nReceipt #4471  12 Nov 2026\n2x Flat white  7.00\n1x Croissant 3.50\nSubtotal 10.50\nVAT 21% 2.20\nTotal due: €12.70";
const dutch = "ENERGIE NV\nFactuur nr: 2026-8812\nDatum 03-11-2026 Vervaldatum 17-11-2026\nStroom verbruik 312 kWh x 0,28 = 87,36\nVaste kosten 12,50\nBTW 21% 21,03\nTotaal te betalen 120,89 EUR";
const chatty = "hey here's the bill from northwind hosting\nthey charged me 166.98 this month for the server\nplus 9.99 backup addon\ntotal 176.97 thanks";
const tabs = "ACME Ltd\nInvoice: A-77\nDate: 2026/10/05\nWidget A\t3\t10.00\t30.00\nWidget B\t1\t5.5\t5.5\nTotal\t35.50";

describe("looseAmount", () => {
  it("reads both decimal conventions", () => {
    expect(looseAmount("1.234,56")).toBe("1234.56");
    expect(looseAmount("1,234.56")).toBe("1234.56");
    expect(looseAmount("12,50")).toBe("12.50");
    expect(looseAmount("€ 12")).toBe("12");
    expect(looseAmount("1.234")).toBe("1234");
    expect(looseAmount("abc")).toBeNull();
  });
});

describe("messy pasted bills are read instead of rejected", () => {
  it("a café receipt with 2x prefixes and a stated total", () => {
    const e = parseText(coffee, "EUR");
    expect(e.vendorName).toBe("Bean There Coffee Co");
    expect(e.number).toBe("4471");
    expect(e.date).toBe("2026-11-12");
    expect(e.currency).toBe("EUR");
    expect(e.lines.map((l) => [l.description, l.quantity, l.total])).toEqual([["Flat white", "2", "7.00"], ["Croissant", "1", "3.50"]]);
    expect(e.lines[0].unitPrice).toBe("3.50");
    expect(e.total).toBe("12.70");
    expect(e.taxRate).toBe("21");
    expect(e.notes?.join(" ")).toMatch(/line total/);
  });
  it("a Dutch utility bill with comma decimals, day-first dates and quantity × price = total", () => {
    const e = parseText(dutch, "EUR");
    expect(e.vendorName).toBe("ENERGIE NV");
    expect(e.number).toBe("2026-8812");
    expect(e.date).toBe("2026-11-03");
    expect(e.dueDate).toBe("2026-11-17");
    expect(e.lines[0]).toMatchObject({ quantity: "312", unitPrice: "0.28", total: "87.36" });
    expect(e.lines[1]).toMatchObject({ description: "Vaste kosten", total: "12.50", kind: "fee" });
    expect(e.total).toBe("120.89");
  });
  it("a chatty note", () => {
    const e = parseText(chatty, "EUR");
    expect(e.vendorName).toBe("Northwind Hosting");
    expect(e.lines.map((l) => [l.description, l.total])).toEqual([["server", "166.98"], ["backup addon", "9.99"]]);
    expect(e.total).toBe("176.97");
    expect(e.lowConfidence).toContain("number"); // never invented: the user is asked
  });
  it("a tab-separated table with a 'Key: value' header", () => {
    const e = parseText(tabs, "EUR");
    expect(e.vendorName).toBe("ACME Ltd");
    expect(e.number).toBe("A-77");
    expect(e.date).toBe("2026-10-05");
    expect(e.lines.map((l) => [l.quantity, l.unitPrice, l.total])).toEqual([["3", "10.00", "30.00"], ["1", "5.5", "5.5"]]);
    expect(e.total).toBe("35.50");
  });
  it("every loosely read invoice must be confirmed, and says what it assumed", () => {
    for (const t of [coffee, dutch, chatty, tabs]) {
      const e = parseText(t, "EUR");
      if (t !== tabs) expect(e.notes?.length).toBeGreaterThan(0);
      expect(e.lowConfidence).toContain("total");
    }
  });
  it("flags an ambiguous day/month date for confirmation", () => {
    const e = parseText("Shop\nDate 03/04/2026\nThing 4.00\nTotal 4.00", "EUR");
    expect(e.date).toBe("2026-04-03");
    expect(e.lowConfidence).toContain("date");
    expect(e.notes?.join(" ")).toMatch(/day-first/);
  });
  it("a bare total still yields something to confirm, and says so", () => {
    const e = parseText("Water company\ntotal due 45.00", "EUR");
    expect(e.lines).toHaveLength(1);
    expect(e.notes?.join(" ")).toMatch(/no individual line items/i);
  });
  it("does not mistake addresses, phone numbers and VAT ids for line items", () => {
    const e = parseText("Shop BV\nKeizersgracht 12, 1015 CS Amsterdam\nTel 020 123 4567\nBTW-nr NL123456789B01\nPens 2 x 1.50 = 3.00\nTotal 3.00", "EUR");
    expect(e.lines.map((l) => l.description)).toEqual(["Pens"]);
  });
  it("still rejects text with nothing money-like in it, with a helpful message", () => {
    expect(() => parseText("hello there, how are you", "EUR")).toThrow(/Couldn't find any line items/);
  });
  it("leaves Overbill's own pipe format exactly as before", () => {
    const e = parseText("Vendor: Acme\nInvoice: X-1\nWidget | 2 | 10.00 | 20.00\nTotal: 20.00", "EUR");
    expect(e.notes).toBeUndefined();
    expect(e.lines).toHaveLength(1);
  });
});
