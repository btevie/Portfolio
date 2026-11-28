import { describe, expect, it } from "vitest";
import { createSeedState } from "../data/seed";
import type { Invoice } from "../types";
import type { BankTx } from "./match";
import { D } from "../audit/money";
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
    const r = parseStatement("Date,Description,Amount\n2026-11-03,NORTHWIND HOSTING NW-47,-166.98\n2026-11-04,SALARY IN,2500.00\n", { convention: "negative-out" });
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
    const dups = findDuplicatePayments(parseStatement(stmt, { convention: "negative-out" }).txs, invoices);
    expect(dups).toHaveLength(1);
    expect(dups[0].kind).toBe("same-invoice");
    expect(dups[0].refundable.toFixed(2)).toBe(Number(inv.total).toFixed(2));
  });
  it("does not flag a vendor that bills the same amount every month, when each payment has its own invoice", () => {
    const same = invoices.filter((i) => i.vendorName.startsWith("Northwind"));
    const total = same[0].total;
    const n = same.filter((i) => i.total === total).length;
    const stmt = "Date,Description,Amount\n" + Array.from({ length: n }, (_, k) => `2026-0${k + 1}-03,NORTHWIND HOSTING,-${total}`).join("\n");
    expect(findDuplicatePayments(parseStatement(stmt, { convention: "negative-out" }).txs, invoices)).toHaveLength(0);
    const extra = stmt + `\n2026-11-03,NORTHWIND HOSTING,-${total}`;
    expect(findDuplicatePayments(parseStatement(extra, { convention: "negative-out" }).txs, invoices)[0]?.refundable.toFixed(2)).toBe(Number(total).toFixed(2));
  });
  it("does not flag a single payment", () => {
    const stmt = `Date,Description,Amount\n2026-11-03,${inv.vendorName},-${inv.total}\n`;
    expect(findDuplicatePayments(parseStatement(stmt, { convention: "negative-out" }).txs, invoices)).toHaveLength(0);
  });
  it("flags the same charge twice in a week even with no matching invoice", () => {
    const dups = findDuplicatePayments(parseStatement("Date,Description,Amount\n2026-11-03,ACME TOOLS,-40.00\n2026-11-05,ACME TOOLS,-40.00\n", { convention: "negative-out" }).txs, invoices);
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
    const r = parseStatement("Date,Description,Amount\nsoon,ACME,-40.00\n2026-11-03,ACME,lots\n2026-11-04,OK,-1.00\n", { convention: "negative-out" });
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
  const dups = findDuplicatePayments(parseStatement(stmt, { convention: "negative-out" }).txs, invoices);
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

describe("payment matching review fixes", () => {
  const inv = (id: string, vendor: string, number: string): Invoice => ({
    id, vendorId: id, vendorName: vendor, number, date: "2026-11-01", dueDate: "2026-11-15", currency: "EUR", subtotal: "40.00", total: "40.00", taxAmount: "0.00", taxRate: "0", discounts: "0.00", fees: "0.00",
    lineItems: [], paymentStatus: "paid", source: "upload", createdAt: 1, notes: "",
  } as unknown as Invoice);
  const tx = (line: number, date: string, description: string): BankTx => ({ date, description, amount: "40.00", line });

  it("two invoices of the same amount explain two nearby vendor-only payments", () => {
    const out = findDuplicatePayments([tx(2, "2026-11-03", "ACME PAYMENT"), tx(3, "2026-11-05", "ACME PAYMENT")], [inv("a", "Acme", "A-1"), inv("b", "Acme", "A-2")]);
    expect(out).toHaveLength(0);
  });

  it("does not pair a payment with the wrong vendor's identical invoice number", () => {
    const out = findDuplicatePayments([tx(2, "2026-11-03", "Acme INV-001"), tx(3, "2026-11-04", "Beta INV-001")], [inv("a", "Acme", "INV-001"), inv("b", "Beta", "INV-001")]);
    expect(out.filter((d) => d.strength === "strong")).toHaveLength(0);
  });

  it("counts a numbered payment together with a vendor-only payment for one invoice", () => {
    const out = findDuplicatePayments([tx(2, "2026-11-03", "Acme INV-001"), tx(3, "2026-11-04", "ACME PAYMENT")], [inv("a", "Acme", "INV-001")]);
    expect(out).toHaveLength(1);
    expect(out[0].refundable.toFixed(2)).toBe("40.00");
  });

  it("reads Debit Amount / Credit Amount as split columns", () => {
    const r = parseStatement("Date,Description,Debit Amount,Credit Amount\n2026-11-03,ACME,40.00,\n2026-11-04,REFUND,,5.00\n", {});
    expect(r.ambiguous).toBeFalsy();
    expect(r.txs).toHaveLength(1);
    expect(r.incoming).toHaveLength(1);
  });
});


describe("vendor-only payments next to a double-paid numbered invoice", () => {
  const inv = (id: string, number: string): Invoice => ({
    id, vendorId: "v1", vendorName: "Acme", number, date: "2026-11-01", dueDate: "2026-11-15", currency: "EUR", lineItems: [], subtotal: "40.00", discounts: "0.00", fees: "0.00",
    taxAmount: "0.00", total: "40.00", paymentStatus: "paid", source: "upload", extraction: "csv", createdAt: 1,
  });
  const tx = (line: number, date: string, description: string) => ({ date, description, amount: "40.00", line });
  it("does not let an invoice that a strong match already used explain the vendor-only payments too", () => {
    const found = findDuplicatePayments(
      [tx(2, "2026-11-02", "Acme INV-2026-001"), tx(3, "2026-11-03", "Acme INV-2026-001"), tx(4, "2026-11-04", "ACME PAYMENT"), tx(5, "2026-11-05", "ACME PAYMENT")],
      [inv("a", "INV-2026-001"), inv("b", "INV-2026-002")],
    );
    const total = found.reduce((a, d) => a.plus(d.refundable), D(0));
    expect(total.toFixed(2)).toBe("80.00");
  });
  it("says so when a quoted-number payment is part of a vendor-only group", () => {
    const found = findDuplicatePayments([tx(2, "2026-11-02", "Acme INV-2026-001"), tx(3, "2026-11-03", "ACME PAYMENT")], [inv("a", "INV-2026-001")]);
    expect(found).toHaveLength(1);
    expect(found[0].reasons.join(" ")).toMatch(/quotes? an invoice number/);
  });
});

describe("findDuplicatePayments capacity", () => {
  const invoices = createSeedState().invoices;
  const inv = invoices.find((i) => i.vendorName.startsWith("Northwind"))!;
  it("counts two numbered payments and one vendor-only payment against one invoice as two extra payments in total", () => {
    const stmt = `Date,Description,Amount\n2026-11-03,${inv.vendorName} ${inv.number},-${inv.total}\n2026-11-10,${inv.vendorName} ${inv.number},-${inv.total}\n2026-11-17,${inv.vendorName},-${inv.total}\n`;
    const dups = findDuplicatePayments(parseStatement(stmt, { convention: "negative-out" }).txs, [inv]); // exactly one invoice on file
    const refundable = dups.reduce((t, d) => t.plus(d.refundable), D(0));
    expect(refundable.toFixed(2)).toBe(D(inv.total).times(2).toFixed(2));
    const lines = dups.flatMap((d) => d.txs.map((t) => t.line));
    expect(new Set(lines).size).toBe(lines.length); // each payment is reported once
  });
});


describe("suggestion ids", () => {
  it("differ for two vendors whose payments share dates, amounts and rows", () => {
    const mk = (id: string, vendor: string): Invoice => ({ id, vendorId: id, vendorName: vendor, number: `${vendor}-2026-100`, date: "2026-11-01", dueDate: "2026-11-15", currency: "EUR", lineItems: [], subtotal: "40.00", discounts: "0.00", fees: "0.00", taxAmount: "0.00", total: "40.00", paymentStatus: "paid", source: "upload", extraction: "csv", createdAt: 1 });
    const pay = (vendor: string): BankTx[] => [2, 3].map((line) => ({ date: `2026-11-0${line}`, description: `${vendor} ${vendor}-2026-100`, amount: "40.00", line }));
    const a = findDuplicatePayments(pay("Acme"), [mk("a", "Acme")]);
    const b = findDuplicatePayments(pay("Beta"), [mk("b", "Beta")]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].id).not.toBe(b[0].id);
  });
});

describe("parseStatement is forgiving about format", () => {
  it("reads rows with no header row", () => {
    const r = parseStatement("03/11/2026,NORTHWIND HOSTING NW-47,-166.98\n04/11/2026,SALARY,2500.00\n05/11/2026,ORBIT WORKSPACE,-338.80\n", { convention: "negative-out" });
    expect(r.error).toBeUndefined();
    expect(r.txs.map((t) => t.amount)).toEqual(["166.98", "338.80"]);
    expect(r.txs[0].date).toBe("2026-11-03");
  });
  it("reads rows copied from a web page, separated by tabs or runs of spaces", () => {
    const tabs = parseStatement("12 Nov 2026\tBrightline Telecom\t-74.42\n13 Nov 2026\tCoffee\t-3.50\n", { convention: "negative-out" });
    expect(tabs.txs).toHaveLength(2);
    expect(tabs.txs[0].date).toBe("2026-11-12");
    const spaced = parseStatement("2026/11/12   Brightline Telecom   -74.42\n2026/11/13   Coffee   -3.50\n", { convention: "negative-out" });
    expect(spaced.txs.map((t) => t.amount)).toEqual(["74.42", "3.50"]);
  });
  it("still refuses text that is not a statement", () => {
    expect(parseStatement("hello\nworld").error).toBeTruthy();
  });
});

describe("single Amount column: direction is never assumed", () => {
  const card = "Date,Description,Amount\n2026-11-02,ACME HOSTING,40.00\n2026-11-03,ACME HOSTING,40.00\n2026-11-04,REFUND ACME,-40.00\n";
  const bank = "Date,Description,Amount\n2026-11-02,ACME HOSTING,-40.00\n2026-11-03,CUSTOMER PAYMENT,500.00\n";
  it("asks instead of guessing, and suggests the likelier reading", () => {
    const c = parseStatement(card);
    expect(c.ambiguous).toBe(true);
    expect(c.txs).toEqual([]);
    expect(c.suggested).toBe("positive-out"); // the negative row is a refund
    expect(parseStatement(bank).ambiguous).toBe(true);
    expect(parseStatement(bank).suggested).toBe("negative-out");
  });
  it("with the card convention, the refund is incoming and the two purchases are payments", () => {
    const r = parseStatement(card, { convention: "positive-out" });
    expect(r.txs.map((t) => t.description)).toEqual(["ACME HOSTING", "ACME HOSTING"]);
    expect(r.incoming.map((t) => t.description)).toEqual(["REFUND ACME"]);
  });
  it("gives files with the same columns the same signature", async () => {
    const { statementSignature } = await import("./match");
    expect(statementSignature(card)).toBe(statementSignature(bank));
    expect(statementSignature("Date;Omschrijving;Bedrag\n")).not.toBe(statementSignature(card));
  });
});
