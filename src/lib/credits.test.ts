import { describe, expect, it } from "vitest";
import { createSeedState } from "./data/seed";
import { parseStoredState } from "./data/validate-state";
import { dashboardMetrics, auditAll } from "./data/selectors";
import { addCreditNote, allCreditPositions, creditBalanceByCurrency, creditPosition, creditsToResolve, linkCandidates, linkCredit, pruneCredits, recordSettlement, reverseSettlement, type SettlementInput } from "./credits";
import type { AppState, Invoice } from "./types";

let n = 0;
const ctx = { id: () => `ev-${++n}`, now: () => "2026-11-28T10:00:00.000Z", today: "2026-11-28" };

function withCredit(total = "50.00", over: Partial<Invoice> = {}): { state: AppState; credit: Invoice; bill: Invoice } {
  const seed = createSeedState();
  const bill = seed.invoices.find((i) => i.vendorId === "v-brightline")!;
  const credit: Invoice = { ...bill, id: "cn-1", number: "CN-1", isCredit: true, total, subtotal: total, taxAmount: "0.00", fees: "0.00", discounts: "0.00", lineItems: [], paymentStatus: "unpaid", source: "upload", createdAt: 9_999, ...over };
  return { state: { ...seed, invoices: [...seed.invoices, credit] }, credit, bill };
}
const ok = (r: { ok: boolean; state?: AppState; error?: string }): AppState => { if (!r.ok) throw new Error(r.error); return r.state!; };
const good: SettlementInput = { kind: "refunded", amount: "20.00", date: "2026-11-20", reference: "RF-77", confirmed: true };

describe("credit status is never assumed", () => {
  it("a new credit note is unmatched with its full amount unaccounted for", () => {
    const { state, credit } = withCredit();
    const p = creditPosition(state, credit);
    expect(p.status).toBe("unmatched");
    expect(p.remaining.toFixed(2)).toBe("50.00");
    expect(p.settled.toFixed(2)).toBe("0.00");
  });
  it("linking records the relationship only; the balance is unchanged", () => {
    const { state, credit, bill } = withCredit();
    const s = ok(linkCredit(state, credit.id, bill.id, ctx));
    const p = creditPosition(s, credit);
    expect(p.status).toBe("awaiting");
    expect(p.remaining.toFixed(2)).toBe("50.00");
    expect(s.credits[0].events[0].text).toMatch(/does not mean the credit was applied/);
  });
});

describe("linking rules", () => {
  it("refuses another vendor, another currency, and another credit note", () => {
    const { state, credit } = withCredit();
    const other = state.invoices.find((i) => i.vendorId !== credit.vendorId && !i.isCredit)!;
    expect(linkCredit(state, credit.id, other.id, ctx)).toMatchObject({ ok: false });
    const usd = { ...state, invoices: state.invoices.map((i) => (i.id === "inv-brightline-1" ? { ...i, currency: "USD" } : i)) };
    expect(linkCredit(usd, credit.id, "inv-brightline-1", ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/cannot be matched/) });
    const second = { ...state, invoices: [...state.invoices, { ...credit, id: "cn-2", number: "CN-2" }] };
    expect(linkCredit(second, credit.id, "cn-2", ctx)).toMatchObject({ ok: false });
  });
  it("only offers same-vendor, same-currency bills, never credits", () => {
    const { state, credit } = withCredit();
    const c = linkCandidates(state, credit);
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((i) => !i.isCredit && i.vendorId === credit.vendorId && i.currency === credit.currency)).toBe(true);
  });
  it("unlinking keeps the history and makes it unmatched again", () => {
    const { state, credit, bill } = withCredit();
    const s = ok(linkCredit(ok(linkCredit(state, credit.id, bill.id, ctx)), credit.id, null, ctx));
    expect(creditPosition(s, credit).status).toBe("unmatched");
    expect(s.credits[0].events.map((e) => e.kind)).toEqual(["linked", "unlinked"]);
  });
});

describe("recording what happened", () => {
  it("needs the user's confirmation, evidence, a real date and a sensible amount", () => {
    const { state, credit } = withCredit();
    const bad = (o: Partial<SettlementInput>) => expect(recordSettlement(state, credit.id, { ...good, ...o }, ctx).ok).toBe(false);
    bad({ confirmed: false });
    bad({ reference: "  " });
    bad({ amount: "0" });
    bad({ amount: "-5" });
    bad({ amount: "abc" });
    bad({ amount: "50.01" }); // more than the credit
    bad({ date: "2026-13-40" });
    bad({ date: "2026-12-25" }); // future
    bad({ kind: "applied" }); // no bill chosen
  });
  it("applied needs a same-vendor bill", () => {
    const { state, credit, bill } = withCredit();
    const other = state.invoices.find((i) => i.vendorId !== credit.vendorId && !i.isCredit)!;
    expect(recordSettlement(state, credit.id, { ...good, kind: "applied", appliedToId: other.id }, ctx).ok).toBe(false);
    const s = ok(recordSettlement(state, credit.id, { ...good, kind: "applied", appliedToId: bill.id }, ctx));
    expect(s.credits[0].events[0]).toMatchObject({ kind: "applied", invoiceId: bill.id, reference: "RF-77", confirmed: true });
  });
  it("partial settlements leave a balance, and the rest can be refunded", () => {
    const { state, credit, bill } = withCredit();
    let s = ok(recordSettlement(state, credit.id, { ...good, kind: "applied", appliedToId: bill.id, amount: "20.00" }, ctx));
    let p = creditPosition(s, credit);
    expect(p.status).toBe("partial");
    expect(p.remaining.toFixed(2)).toBe("30.00");
    expect(recordSettlement(s, credit.id, { ...good, amount: "30.01" }, ctx).ok).toBe(false);
    s = ok(recordSettlement(s, credit.id, { ...good, amount: "30.00", reference: "RF-78" }, ctx));
    p = creditPosition(s, credit);
    expect(p.status).toBe("settled");
    expect(p.applied.toFixed(2)).toBe("20.00");
    expect(p.refunded.toFixed(2)).toBe("30.00");
    expect(p.remaining.toFixed(2)).toBe("0.00");
    expect(recordSettlement(s, credit.id, good, ctx).ok).toBe(false); // nothing left to settle
  });
  it("a mistake is reversed, not erased, and the balance returns", () => {
    const { state, credit } = withCredit();
    const s1 = ok(recordSettlement(state, credit.id, good, ctx));
    const id = s1.credits[0].events[0].id;
    expect(reverseSettlement(s1, credit.id, id, "", ctx).ok).toBe(false); // reason required
    const s2 = ok(reverseSettlement(s1, credit.id, id, "Typed the wrong refund", ctx));
    const p = creditPosition(s2, credit);
    expect(p.remaining.toFixed(2)).toBe("50.00");
    expect(s2.credits[0].events).toHaveLength(2); // original kept
    expect(s2.credits[0].events[0].amount).toBe("20.00");
    expect(reverseSettlement(s2, credit.id, id, "again", ctx).ok).toBe(false); // can't reverse twice
  });
  it("notes are kept in the history", () => {
    const { state, credit } = withCredit();
    const s = ok(addCreditNote(state, credit.id, "Emailed vendor", ctx));
    expect(s.credits[0].events[0]).toMatchObject({ kind: "note", text: "Emailed vendor" });
    expect(addCreditNote(state, credit.id, "  ", ctx).ok).toBe(false);
  });
});

describe("finding what needs resolving", () => {
  it("lists unmatched first and drops settled credits; balances are per currency", () => {
    const { state, credit, bill } = withCredit("50.00");
    const eur2 = { ...credit, id: "cn-2", number: "CN-2", total: "80.00" };
    const usd = { ...credit, id: "cn-3", number: "CN-3", total: "10.00", currency: "USD" };
    let s: AppState = { ...state, invoices: [...state.invoices, eur2, usd] };
    s = ok(linkCredit(s, "cn-1", bill.id, ctx));
    s = ok(recordSettlement(s, "cn-3", { ...good, amount: "10.00" }, ctx));
    const todo = creditsToResolve(s);
    expect(todo.map((p) => p.credit.id)).toEqual(["cn-2", "cn-1"]); // unmatched, then awaiting; settled USD gone
    const bal = creditBalanceByCurrency(allCreditPositions(s));
    expect(bal).toHaveLength(1);
    expect(bal[0].currency).toBe("EUR");
    expect(bal[0].amount.toFixed(2)).toBe("130.00");
  });
  it("deleting a linked bill makes the credit unmatched again, with a note in the history", () => {
    const { state, credit, bill } = withCredit();
    let s = ok(linkCredit(state, credit.id, bill.id, ctx));
    s = pruneCredits({ ...s, invoices: s.invoices.filter((i) => i.id !== bill.id) }, ctx);
    expect(creditPosition(s, credit).status).toBe("unmatched");
    expect(s.credits[0].events.at(-1)?.text).toMatch(/deleted/);
  });
  it("deleting the credit note drops its tracking", () => {
    const { state, credit } = withCredit();
    const s = pruneCredits({ ...ok(addCreditNote(state, credit.id, "x", ctx)), invoices: state.invoices.filter((i) => i.id !== credit.id) }, ctx);
    expect(s.credits).toHaveLength(0);
  });
});

describe("credit notes stay out of spend and amounts to pay", () => {
  it("a settled or unsettled credit never changes spend, invoices checked or at-stake figures", () => {
    const base = createSeedState();
    const { state } = withCredit("500.00");
    const settled = ok(recordSettlement(state, "cn-1", { ...good, amount: "500.00" }, ctx));
    const m0 = dashboardMetrics(base, auditAll(base), 6);
    for (const st of [state, settled]) {
      const m = dashboardMetrics(st, auditAll(st), 6);
      expect(m.monthly).toEqual(m0.monthly);
      expect(m.invoicesChecked).toBe(m0.invoicesChecked);
      expect(m.atStake).toEqual(m0.atStake);
    }
  });
});

describe("saved and restored credit data is untrusted", () => {
  const roundTrip = (s: AppState) => parseStoredState(JSON.stringify(s));
  it("round-trips valid tracking", () => {
    const { state, credit, bill } = withCredit();
    const s = ok(recordSettlement(ok(linkCredit(state, credit.id, bill.id, ctx)), credit.id, good, ctx));
    const back = roundTrip(s)!;
    expect(back.state.credits).toHaveLength(1);
    expect(creditPosition(back.state, credit).refunded.toFixed(2)).toBe("20.00");
  });
  it("old saves without credits load as empty", () => {
    const { state } = withCredit();
    const { credits: _c, ...old } = state; void _c;
    expect(parseStoredState(JSON.stringify(old))!.state.credits).toEqual([]);
  });
  it("drops a settlement lacking confirmation or evidence, and tracking for a missing credit note", () => {
    const { state, credit } = withCredit();
    const forged = { ...state, credits: [
      { id: "a", creditId: credit.id, events: [{ id: "e1", at: "2026-11-28T10:00:00.000Z", kind: "refunded", text: "x", amount: "20.00", date: "2026-11-20" }] },
      { id: "b", creditId: "no-such-credit", events: [] },
    ] };
    const back = roundTrip(forged as unknown as AppState)!;
    expect(back.state.credits).toHaveLength(0);
    expect(back.dropped).toBe(2);
  });
});
