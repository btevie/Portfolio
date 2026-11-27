import { describe, expect, it } from "vitest";
import { createSeedState } from "./data/seed";
import { auditAll, openFindings } from "./data/selectors";
import { availableRequests, buildDisputeKit, defaultRequest, kitSummaryText, relatedLines, REQUEST_LABEL } from "./dispute-kit";
import type { AuditFinding, Invoice } from "./types";

const state = createSeedState();
const audits = auditAll(state);
const all = openFindings(state, audits);
const find = (rule: string) => all.find((f) => f.ruleId === rule)!;
const inv = (f: AuditFinding) => state.invoices.find((i) => i.id === f.invoiceId)!;

describe("dispute kit", () => {
  it("never presents an unconfirmed anomaly as an error", () => {
    for (const f of all) {
      const k = buildDisputeKit(inv(f), f, "open", "Sam");
      expect(k.message).toContain("It appears that");
      expect(k.message).not.toContain("Our records show");
      expect(k.message).not.toMatch(/you (overcharged|owe me)/i);
    }
  });
  it("uses firmer wording only once the user confirms", () => {
    const f = all[0];
    const k = buildDisputeKit(inv(f), f, "confirmed", "Sam");
    expect(k.message).toContain("Our records show");
    expect(k.subject).toMatch(/^Query on/);
  });
  it("picks a sensible default ask per finding and offers refund only when money is at stake", () => {
    expect(defaultRequest(find("duplicate_invoice"))).toBe("correct");
    expect(defaultRequest(find("unexpected_fee"))).toBe("explain");
    const noMoney = { ...find("unexpected_fee"), amountAtRisk: "0.00" };
    expect(availableRequests(noMoney)).not.toContain("refund");
    expect(availableRequests(find("duplicate_invoice"))).toContain("refund");
  });
  it("keeps the amount and currency of the invoice, and states the ask clearly", () => {
    const f = find("duplicate_invoice");
    const i = inv(f);
    const refund = buildDisputeKit(i, f, "open", "Sam", "refund");
    expect(refund.amountAtStake).toBe(new Intl.NumberFormat("en-IE", { style: "currency", currency: i.currency }).format(Number(f.amountAtRisk)));
    expect(refund.message).toContain(refund.amountAtStake!);
    expect(refund.message).toMatch(/credit/);
    expect(buildDisputeKit(i, f, "open", "Sam", "explain").message).toMatch(/explain what this charge covers/);
    expect(REQUEST_LABEL.correct).toBe("Correct the invoice");
  });
  it("words a refund differently for a paid invoice, and holds payment for an unpaid one", () => {
    const f = find("duplicate_invoice");
    const unpaid: Invoice = { ...inv(f), paymentStatus: "unpaid" };
    const paid: Invoice = { ...inv(f), paymentStatus: "paid" };
    expect(buildDisputeKit(unpaid, f, "open", "S", "correct").message).toContain("hold payment");
    expect(buildDisputeKit(paid, f, "open", "S", "refund").message).toContain("already paid");
    expect(buildDisputeKit(paid, f, "open", "S", "correct").message).not.toContain("hold payment");
  });
  it("finds the line behind a line-level finding and lists the calculation and evidence", () => {
    const f = find("arithmetic");
    const k = buildDisputeKit(inv(f), f, "open", "Sam");
    expect(relatedLines(inv(f), f).length).toBeGreaterThan(0);
    expect(k.lines.length).toBeGreaterThan(0);
    expect(k.calculation.map((c) => c[0])).toEqual(expect.arrayContaining(["Should be", "Invoice says", "Difference"]));
    expect(k.evidence.length).toBeGreaterThan(0);
    const text = kitSummaryText(inv(f), f, k);
    expect(text).toContain("CALCULATION");
    expect(text).toContain("not confirmed");
  });
  it("is concise and signs with the sender's name", () => {
    const f = all[0];
    const k = buildDisputeKit(inv(f), f, "open", "Sam Tester");
    expect(k.message.trimEnd().endsWith("Sam Tester")).toBe(true);
    expect(k.message.split("\n").length).toBeLessThan(16);
  });
});

describe("disputePackHtml", () => {
  it("is a printable page with the edited message, the calculation and an unconfirmed notice, with markup escaped", async () => {
    const { disputePackHtml } = await import("./dispute-kit");
    const f = find("arithmetic");
    const k = buildDisputeKit(inv(f), f, "open", "Sam");
    const html = disputePackHtml(inv(f), f, k, "Hello <b>team</b> & co");
    expect(html).toContain("Dispute pack: invoice");
    expect(html).toContain("Hello &lt;b&gt;team&lt;/b&gt; &amp; co");
    expect(html).toContain("not a confirmed error");
    expect(html).toContain("Calculation");
  });
});
