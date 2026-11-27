import { describe, expect, it } from "vitest";
import { createSeedState } from "../data/seed";
import { applyCorrections, findDuplicatePayments, parseStatement, toAmount } from "./match";

describe("toAmount", () => {
  it("reads signs, brackets and both decimal styles", () => {
    expect(toAmount("-1.234,56")).toBe("-1234.56");
    expect(toAmount("(12.50)")).toBe("-12.50");
    expect(toAmount("€1,234.50")).toBe("1234.50");
    expect(toAmount("abc")).toBeNull();
  });
});

describe("parseStatement", () => {
  it("keeps only money going out, from a signed amount column", () => {
    const r = parseStatement("Date,Description,Amount\n2026-11-03,NORTHWIND HOSTING NW-47,-166.98\n2026-11-04,SALARY IN,2500.00\n");
    expect(r.txs).toHaveLength(1);
    expect(r.txs[0].amount).toBe("166.98");
  });
  it("accepts semicolons, day-first dates and a debit column", () => {
    const r = parseStatement("Datum;Omschrijving;Debit\n03/11/2026;Orbit Workspace;338,80\n");
    expect(r.txs[0]).toMatchObject({ date: "2026-11-03", amount: "338.80" });
  });
  it("explains a file it cannot read", () => {
    expect(parseStatement("a,b\n1,2").error).toMatch(/Couldn't find/);
  });
});

describe("findDuplicatePayments", () => {
  const invoices = createSeedState().invoices;
  const inv = invoices.find((i) => i.vendorName.startsWith("Northwind"))!;
  it("flags one invoice paid twice and counts only the extra payment as refundable", () => {
    const stmt = `Date,Description,Amount\n2026-11-03,${inv.vendorName} ${inv.number},-${inv.total}\n2026-11-10,${inv.vendorName} ${inv.number},-${inv.total}\n`;
    const dups = findDuplicatePayments(parseStatement(stmt).txs, invoices);
    expect(dups).toHaveLength(1);
    expect(dups[0].kind).toBe("same-invoice");
    expect(dups[0].refundable.toFixed(2)).toBe(Number(inv.total).toFixed(2));
  });
  it("does not flag a vendor that bills the same amount every month, when each payment has its own invoice", () => {
    const same = invoices.filter((i) => i.vendorName.startsWith("Northwind"));
    const total = same[0].total;
    const n = same.filter((i) => i.total === total).length;
    const stmt = "Date,Description,Amount\n" + Array.from({ length: n }, (_, k) => `2026-0${k + 1}-03,NORTHWIND HOSTING,-${total}`).join("\n");
    expect(findDuplicatePayments(parseStatement(stmt).txs, invoices)).toHaveLength(0);
    const extra = stmt + `\n2026-11-03,NORTHWIND HOSTING,-${total}`;
    expect(findDuplicatePayments(parseStatement(extra).txs, invoices)[0]?.refundable.toFixed(2)).toBe(Number(total).toFixed(2));
  });
  it("does not flag a single payment", () => {
    const stmt = `Date,Description,Amount\n2026-11-03,${inv.vendorName},-${inv.total}\n`;
    expect(findDuplicatePayments(parseStatement(stmt).txs, invoices)).toHaveLength(0);
  });
  it("flags the same charge twice in a week even with no matching invoice", () => {
    const dups = findDuplicatePayments(parseStatement("Date,Description,Amount\n2026-11-03,ACME TOOLS,-40.00\n2026-11-05,ACME TOOLS,-40.00\n").txs, invoices);
    expect(dups[0].kind).toBe("repeat-charge");
  });
});

describe("sign conventions", () => {
  const allPositive = "Date,Description,Amount\n2026-11-03,ACME TOOLS,40.00\n2026-11-05,ACME TOOLS,40.00\n2026-11-06,REFUND,15.00\n";
  it("refuses to guess when every amount has the same sign", () => {
    const r = parseStatement(allPositive);
    expect(r.ambiguous).toBe(true);
    expect(r.txs).toHaveLength(0);
  });
  it("positive-out reads positives as payments and negatives as incoming", () => {
    const r = parseStatement(allPositive + "2026-11-07,REFUND,-5.00\n", { convention: "positive-out" });
    expect(r.txs).toHaveLength(3);
    expect(r.incoming).toHaveLength(1);
    expect(r.incoming[0].amount).toBe("5.00");
  });
  it("positive amounts chosen as money received are never treated as payments", () => {
    const r = parseStatement(allPositive, { convention: "negative-out" });
    expect(r.txs).toHaveLength(0);
    expect(r.incoming).toHaveLength(3);
  });
  it("separate debit and credit columns keep credits out of the payments", () => {
    const r = parseStatement("Date,Description,Debit,Credit\n2026-11-03,ACME,40.00,\n2026-11-04,SALARY,,2500.00\n");
    expect(r.convention).toBe("split-columns");
    expect(r.txs.map((t) => t.amount)).toEqual(["40.00"]);
    expect(r.incoming.map((t) => t.amount)).toEqual(["2500.00"]);
  });
  it("explains unreadable rows instead of dropping them", () => {
    const r = parseStatement("Date,Description,Amount\nsoon,ACME,-40.00\n2026-11-03,ACME,lots\n2026-11-04,OK,-1.00\n");
    expect(r.unreadable.map((u) => u.line)).toEqual([2, 3]);
    expect(r.unreadable[0].reason).toMatch(/Date/);
    expect(r.unreadable[1].reason).toMatch(/not a number/);
    expect(r.txs).toHaveLength(1);
  });
});

describe("match evidence and corrections", () => {
  const invoices = createSeedState().invoices;
  const inv = invoices.find((i) => i.vendorName.startsWith("Northwind"))!;
  const stmt = `Date,Description,Amount\n2026-11-03,${inv.vendorName} ${inv.number},-${inv.total}\n2026-11-10,${inv.vendorName} ${inv.number},-${inv.total}\n`;
  const dups = findDuplicatePayments(parseStatement(stmt).txs, invoices);
  it("carries strength and reasons, never 'confirmed'", () => {
    expect(dups[0].strength).toBe("strong");
    expect(dups[0].reasons.length).toBeGreaterThan(1);
  });
  it("dismissing hides it; removing a payment drops it below two and recomputes", () => {
    const none = { dismissed: new Set<string>(), removed: new Set<number>(), relinked: new Map<string, string>() };
    expect(applyCorrections(dups, { ...none, dismissed: new Set([dups[0].id]) }).shown).toHaveLength(0);
    expect(applyCorrections(dups, { ...none, removed: new Set([dups[0].txs[0].line]) }).shown).toHaveLength(0);
    expect(applyCorrections(dups, none).shown[0].refundable.toFixed(2)).toBe(Number(inv.total).toFixed(2));
  });
});
