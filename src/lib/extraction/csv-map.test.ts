import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCsv, mappedText, missingRequired, rememberMapping } from "./csv-map";
import { parseCsv } from "./parsers";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});

const THEIRS = "Supplier,Inv No,Date,Item,Qty,Price,Amount\nAcme Ltd,A-1,2026-11-01,Hosting,2,10.00,20.00\nAcme Ltd,A-1,2026-11-01,Support,1,5.00,5.00";

describe("CSV column mapping", () => {
  it("leaves a file with Overbill's own headers alone", () => {
    const a = analyzeCsv("description,quantity,unit_price\nX,1,2");
    expect(a.status).toBe("ready");
    expect(a.basis).toBe("exact");
  });
  it("asks the user to confirm other headers, and shows the guess", () => {
    const a = analyzeCsv(THEIRS);
    expect(a.status).toBe("confirm");
    expect(a.map.description).toBe(3);
    expect(a.map.quantity).toBe(4);
    expect(a.map.unit_price).toBe(5);
    expect(a.map.line_total).toBe(6);
    expect(a.map.vendor).toBe(0);
    expect(missingRequired(a.map)).toEqual([]);
  });
  it("produces text the existing parser reads, using the confirmed mapping", () => {
    const a = analyzeCsv(THEIRS);
    const r = parseCsv(mappedText(a, a.map), "EUR");
    expect(r.vendorName).toBe("Acme Ltd");
    expect(r.lines.map((l) => l.total)).toEqual(["20.00", "5.00"]);
  });
  it("reports what is missing, and remembers a mapping for the same headers", () => {
    const a = analyzeCsv("Thing,How many,Cost each\nA,1,2");
    expect(missingRequired(a.map)).toEqual(["Description", "Quantity", "Unit price"]);
    const fixed = { ...a.map, description: 0, quantity: 1, unit_price: 2 };
    rememberMapping(a, fixed);
    const again = analyzeCsv("Thing,How many,Cost each\nB,3,4");
    expect(again.status).toBe("ready");
    expect(again.basis).toBe("remembered");
    expect(parseCsv(again.text, "EUR").lines[0].quantity).toBe("3");
  });
  it("does not use one column for two fields", () => {
    const a = analyzeCsv("description,qty,price,total\nX,1,2,2");
    const used = Object.values(a.map).filter((v) => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });
});
