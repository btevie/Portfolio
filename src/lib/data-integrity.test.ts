import { describe, expect, it } from "vitest";
import { createSeedState } from "./data/seed";
import { parseStoredState } from "./data/validate-state";
import { atStakeByCurrency, auditAll, dashboardMetrics, invoiceExposure, openFindings } from "./data/selectors";
import { D, isValidDecimal } from "./audit/money";
import { isCurrency } from "./currencies";
import type { AppState, Invoice, InvoiceLineItem } from "./types";

const MONEY = /^-?\d+(\.\d+)?$/;

/** Small seeded PRNG so a failure reproduces. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

describe("sample data", () => {
  const s = createSeedState();
  it("has unique ids, valid references, valid currencies and decimal-string money", () => {
    const ids = s.invoices.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of s.invoices) {
      expect(s.vendors.some((v) => v.id === i.vendorId), `vendor of ${i.id}`).toBe(true);
      expect(isCurrency(i.currency), `currency of ${i.id}`).toBe(true);
      for (const v of [i.subtotal, i.discounts, i.fees, i.taxAmount, i.total, ...i.lineItems.flatMap((l) => [l.quantity, l.unitPrice, l.total])]) expect(isValidDecimal(v), `${i.id}: ${v}`).toBe(true);
      expect(Date.parse(i.date), `date of ${i.id}`).not.toBeNaN();
      expect(Date.parse(i.dueDate), `due date of ${i.id}`).not.toBeNaN();
    }
    for (const r of s.recovery) if (r.invoiceId) expect(ids.includes(r.invoiceId), `case ${r.id} invoice`).toBe(true);
  });
  it("survives a save and reload with nothing dropped or changed", () => {
    const back = parseStoredState(JSON.stringify(s));
    expect(back?.dropped).toBe(0);
    expect(back?.state.invoices).toEqual(s.invoices);
    expect(back?.state.vendors).toEqual(s.vendors);
    const byId = <T extends { id: string }>(l: T[]) => [...l].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(back!.state.recovery)).toEqual(byId(s.recovery)); // reload may reorder cases, never change them
  });
  it("audits the same way every time", () => {
    expect(JSON.stringify(auditAll(s))).toBe(JSON.stringify(auditAll(structuredClone(s))));
  });
  it("adds up at-stake money per currency, from the same per-invoice figures the pages show", () => {
    const audits = auditAll(s);
    const expected = new Map<string, ReturnType<typeof D>>();
    for (const i of s.invoices) { if (i.isCredit || i.extraction === "mock") continue; const e = invoiceExposure(audits[i.id].findings.filter((f) => !s.decisions[f.id]), i.total); if (e.gt(0)) expected.set(i.currency, (expected.get(i.currency) ?? D(0)).plus(e)); }
    const got = atStakeByCurrency(s, audits).totals;
    expect(got.length).toBe(expected.size);
    for (const t of got) expect(t.amount.toFixed(2)).toBe(expected.get(t.currency)!.toFixed(2));
  });
});

describe("fuzzed invoices", () => {
  const CURRENCIES = ["EUR", "USD", "GBP", "JPY", "CHF"];
  const money = (r: () => number, max = 500) => (Math.floor(r() * max * 100) / 100).toFixed(2);
  function invoice(r: () => number, n: number, state: AppState): Invoice {
    const vendor = state.vendors[Math.floor(r() * state.vendors.length)];
    const lines: InvoiceLineItem[] = Array.from({ length: 1 + Math.floor(r() * 5) }, (_, k) => {
      const q = String(1 + Math.floor(r() * 9)), u = money(r, 200);
      // Sometimes the printed line total is wrong, sometimes a fee line, sometimes a zero price.
      const total = r() < 0.2 ? money(r, 900) : D(q).times(D(u)).toFixed(2);
      return { id: `l${n}-${k}`, description: r() < 0.3 ? "Setup fee" : `Service ${Math.floor(r() * 4)}`, quantity: q, unitPrice: r() < 0.05 ? "0.00" : u, total, kind: r() < 0.2 ? "fee" : "item", taxRate: r() < 0.5 ? "21" : undefined };
    });
    const sub = lines.filter((l) => l.kind === "item").reduce((a, l) => a.plus(D(l.total)), D(0)), fees = lines.filter((l) => l.kind === "fee").reduce((a, l) => a.plus(D(l.total)), D(0));
    const tax = sub.times("0.21").toDecimalPlaces(2);
    const total = r() < 0.25 ? D(money(r, 3000)) : sub.plus(tax).plus(fees);
    const day = 1 + Math.floor(r() * 28), month = 1 + Math.floor(r() * 12);
    const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { id: `fz-${n}`, vendorId: vendor.id, vendorName: vendor.name, number: r() < 0.1 ? "" : `F-${Math.floor(r() * 40)}`, date, dueDate: r() < 0.1 ? "2026-01-01" : `2026-${String(month).padStart(2, "0")}-28`, currency: CURRENCIES[Math.floor(r() * CURRENCIES.length)], lineItems: lines, subtotal: sub.toFixed(2), discounts: "0.00", fees: fees.toFixed(2), taxAmount: tax.toFixed(2), total: total.toFixed(2), paymentStatus: r() < 0.5 ? "paid" : "unpaid", source: "upload", extraction: "csv", createdAt: n };
  }

  it("never produces NaN, negative or unbounded money, duplicate ids or contradictory verdicts", () => {
    const base = createSeedState();
    const r = rng(20261128);
    const state: AppState = { ...base, invoices: Array.from({ length: 400 }, (_, n) => invoice(r, n, base)), recovery: [], decisions: {} };
    const audits = auditAll(state);
    const bad: string[] = [];
    for (const i of state.invoices) {
      const a = audits[i.id];
      const ids = a.findings.map((f) => f.id);
      if (new Set(ids).size !== ids.length) bad.push(`${i.id}: duplicate finding ids`);
      if ((a.classification === "CLEAR") !== (a.findings.length === 0)) bad.push(`${i.id}: classification ${a.classification} with ${a.findings.length} findings`);
      for (const f of a.findings) {
        const text = JSON.stringify(f);
        if (/NaN|Infinity|undefined|\[object/.test(text)) bad.push(`${i.id}/${f.ruleId}: bad text in finding`);
        if (!MONEY.test(f.amountAtRisk)) bad.push(`${i.id}/${f.ruleId}: amountAtRisk "${f.amountAtRisk}"`);
        else if (D(f.amountAtRisk).lt(0)) bad.push(`${i.id}/${f.ruleId}: negative amountAtRisk ${f.amountAtRisk}`);
        if (f.invoiceId !== i.id) bad.push(`${i.id}: finding ${f.id} points at ${f.invoiceId}`);
      }
      const exposure = invoiceExposure(a.findings, i.total);
      if (D(i.total).gt(0) && exposure.gt(D(i.total))) bad.push(`${i.id}: exposure ${exposure.toFixed(2)} above total ${i.total}`);
    }
    expect(bad.slice(0, 15)).toEqual([]);
  });

  it("keeps currencies apart in every total on the dashboard", () => {
    const base = createSeedState();
    const r = rng(7);
    const state: AppState = { ...base, invoices: Array.from({ length: 120 }, (_, n) => invoice(r, n, base)), recovery: [], decisions: {} };
    const audits = auditAll(state);
    const stake = atStakeByCurrency(state, audits).totals;
    expect(new Set(stake.map((t) => t.currency)).size).toBe(stake.length);
    const m = dashboardMetrics(state, audits, 6);
    expect(m.atStake.map((t) => t.currency).sort()).toEqual(stake.map((t) => t.currency).sort());
    expect(openFindings(state, audits).every((f) => f.invoiceId.startsWith("fz-") || f.invoiceId.startsWith("inv-"))).toBe(true);
  });
});

describe("currency precision", () => {
  it("shows each currency with its own number of decimals", async () => {
    const { formatMoney } = await import("./audit/money");
    const sp = (x: string) => x.replace(/\s/g, " ");
    expect(sp(formatMoney("1234.567", "BHD"))).toBe("BHD 1,234.567");
    expect(sp(formatMoney("1234.567", "KWD"))).toBe("KWD 1,234.567");
    expect(formatMoney("1234.567", "JPY")).toMatch(/1,235$/);
    expect(formatMoney("1234.567", "EUR")).toBe("€1,234.57");
    expect(formatMoney("-0.004", "EUR")).toBe("€0.00");
  });
  it("keeps a 3-decimal statement amount exact so it still matches the invoice", async () => {
    const { parseStatement } = await import("./payments/match");
    const r = parseStatement("Date,Description,Amount\n2026-11-02,ACME,-12.345\n2026-11-03,ACME,-12.5\n", { convention: "negative-out" });
    expect(r.txs.map((t) => t.amount)).toEqual(["12.345", "12.50"]);
  });
});

describe("corrupted or hostile saved data", () => {
  it("never throws, and whatever loads can be audited", () => {
    const base = JSON.parse(JSON.stringify(createSeedState()));
    const r = rng(99);
    const junk: unknown[] = [null, undefined, "x", 0, -1, 1e308, [], {}, true, "<script>", "9".repeat(5000), { __proto__: { polluted: true } }, "2026-02-30", NaN];
    const paths = (o: unknown, p: (string | number)[] = []): (string | number)[][] => (o && typeof o === "object" ? Object.entries(o as object).flatMap(([k, v]) => paths(v, [...p, Array.isArray(o) ? Number(k) : k])) : [p]);
    const all = paths(base);
    let loaded = 0;
    for (let n = 0; n < 300; n++) {
      const copy = JSON.parse(JSON.stringify(base));
      for (let m = 0; m < 1 + Math.floor(r() * 4); m++) {
        const path = all[Math.floor(r() * all.length)];
        let cur = copy;
        for (const k of path.slice(0, -1)) { if (cur?.[k] === undefined) break; cur = cur[k]; }
        const last = path[path.length - 1];
        if (cur && typeof cur === "object") { if (r() < 0.2) delete cur[last]; else cur[last] = junk[Math.floor(r() * junk.length)]; }
      }
      const raw = JSON.stringify(copy);
      const parsed = parseStoredState(raw);
      if (!parsed) continue;
      loaded++;
      const audits = auditAll(parsed.state); // must not throw on anything that loaded
      expect(Object.keys(audits).length).toBe(parsed.state.invoices.length);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      for (const i of parsed.state.invoices) expect(isValidDecimal(i.total)).toBe(true);
    }
    expect(loaded).toBeGreaterThan(50);
  });
});

describe("order independence", () => {
  it("gives the same findings however the invoices are ordered", () => {
    const s = createSeedState();
    const r = rng(5);
    const shuffled = [...s.invoices].sort(() => r() - 0.5);
    const key = (st: AppState) => Object.values(auditAll(st)).flatMap((a) => a.findings.map((f) => `${f.invoiceId}|${f.id}|${f.amountAtRisk}|${f.severity}`)).sort();
    expect(key({ ...s, invoices: shuffled })).toEqual(key(s));
  });
  it("gives the same recurring-bill signals however the invoices are ordered", async () => {
    const { recurringSignals } = await import("./recurring-watch");
    const s = createSeedState();
    const sig = (inv: Invoice[]) => recurringSignals(inv, "2026-12-20").map((x) => `${x.vendorId}|${x.kind}|${x.headline}`).sort();
    const r = rng(11);
    expect(sig([...s.invoices].sort(() => r() - 0.5))).toEqual(sig(s.invoices));
  });
});

describe("amount thresholds follow the invoice currency", () => {
  it("does not call a 20 yen tax difference serious, but does for 20 euro", async () => {
    const { auditInvoice, configFromSettings } = await import("./audit/engine");
    const s = createSeedState();
    const mk = (currency: string, amount: string): Invoice => ({ id: "t1", vendorId: "v-x", vendorName: "Xco", number: "X-1", date: "2026-11-01", dueDate: "2026-11-15", currency, lineItems: [{ id: "l1", description: "Service", quantity: "1", unitPrice: amount, total: amount, kind: "item", taxRate: "10" }], subtotal: amount, discounts: "0.00", fees: "0.00", taxAmount: D(amount).times("0.10").plus(20).toFixed(2), total: D(amount).times("1.10").plus(20).toFixed(2), taxRate: "10", paymentStatus: "unpaid", source: "upload", extraction: "csv", createdAt: 1 });
    const sev = (currency: string, amount: string) => auditInvoice(mk(currency, amount), { today: "2026-11-28", invoices: [], contractRates: [], config: configFromSettings(s.settings) }).findings.find((f) => f.ruleId === "tax" && f.id.endsWith(":amount"))?.severity;
    expect(sev("EUR", "1000.00")).toBe("high");
    expect(sev("JPY", "100000.00")).toBe("medium");
  });
});
