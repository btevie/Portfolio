import { describe, expect, it } from "vitest";
import { createSeedState } from "./seed";
import { actionQueue, auditAll, dashboardMetrics, stakeByVendor, pendingCreditNote, recoveryStats, invoiceExposure } from "./selectors";
import { D } from "../audit/money";
import type { AuditFinding, RecoveryRecord } from "../types";

const rec = (id: string, status: RecoveryRecord["status"], amount: string): RecoveryRecord => ({
  id, vendorId: "v", vendorName: "V", title: id, amount, currency: "EUR", status, notes: "", createdAt: "2026-01-01", updatedAt: "2026-01-01",
});

describe("recovery metrics: received vs pending credit", () => {
  const seed = createSeedState();
  const stats = recoveryStats(seed.recovery, "EUR");

  it("seed: €192.40 received, €25.00 credit pending and excluded from received", () => {
    expect(stats.recovered.toFixed(2)).toBe("192.40");
    expect(stats.pendingCredit.toFixed(2)).toBe("25.00");
    expect(stats.pendingCreditCount).toBe(1);
  });

  it("a pending credit is not a paid-out case and not a closed case", () => {
    expect(stats.won).toBe(2); // two Recovered records only
    expect(stats.resolved).toBe(3); // 2 recovered + 1 dismissed; the credit is still open
    expect(stats.rate).toBe(67);
  });

  it("applying the credit (status → recovered) moves it into received money and the rate", () => {
    const applied = seed.recovery.map((r) => (r.status === "credit_issued" ? { ...r, status: "recovered" as const } : r));
    const s = recoveryStats(applied, "EUR");
    expect(s.recovered.toFixed(2)).toBe("217.40");
    expect(s.pendingCreditCount).toBe(0);
    expect(s.rate).toBe(75); // 3 of 4
  });

  it("a lone pending credit gives no success rate and still counts as potential savings", () => {
    const s = recoveryStats([rec("a", "credit_issued", "25.00")], "EUR");
    expect(s.rate).toBeNull();
    expect(s.recovered.toFixed(2)).toBe("0.00");
    expect(s.potential.toFixed(2)).toBe("25.00");
  });

  it("dashboard and tracker share one calculation", () => {
    const m = dashboardMetrics(seed, auditAll(seed));
    expect(m.recovered.toFixed(2)).toBe(stats.recovered.toFixed(2));
    expect(m.recoveryStats.pendingCredit.toFixed(2)).toBe("25.00");
  });

  it("wording names the pending credit", () => {
    expect(pendingCreditNote(stats, (d) => `€${d.toFixed(2)}`)).toBe("€25.00 in credit issued, not yet applied");
    expect(pendingCreditNote(recoveryStats([], "EUR"), () => "")).toBeNull();
  });
});

describe("action center", () => {
  const seed = createSeedState();
  const audits = auditAll(seed);
  const queue = actionQueue(seed, audits);

  it("ranks unpaid before paid, then severity, then due date", () => {
    expect(queue.length).toBeGreaterThan(0);
    const sev = { high: 0, medium: 1, low: 2 } as const;
    for (let i = 1; i < queue.length; i++) {
      const a = queue[i - 1], b = queue[i];
      const key = (x: typeof a) => [Number(x.invoice.paymentStatus === "paid"), sev[x.finding.severity], x.invoice.dueDate];
      const [pa, sa, da] = key(a), [pb, sb, db] = key(b);
      expect(pa < pb || (pa === pb && (sa < sb || (sa === sb && String(da) <= String(db))))).toBe(true);
    }
  });

  it("stake per vendor sums to the open amount at risk in the dashboard currency", () => {
    const m = dashboardMetrics(seed, audits);
    const total = stakeByVendor(queue, m.currency).reduce((a, v) => a.plus(v.amount), D(0));
    expect(total.toFixed(2)).toBe(m.potentialOvercharges.toFixed(2));
  });

  it("flagged spend is never more than total spend", () => {
    for (const mo of dashboardMetrics(seed, audits, 12).monthly) expect(mo.flagged).toBeLessThanOrEqual(mo.total);
  });
});

describe("invoiceExposure", () => {
  const f = (ruleId: string, amountAtRisk: string) => ({ ruleId, amountAtRisk }) as unknown as AuditFinding;
  it("counts one arithmetic cascade once (largest wins), but independent rules add up", () => {
    expect(invoiceExposure([f("arithmetic", "10.00"), f("arithmetic", "12.00"), f("arithmetic", "12.00")], "500.00").toFixed(2)).toBe("12.00");
    expect(invoiceExposure([f("arithmetic", "12.00"), f("unexpected_fee", "8.00")], "500.00").toFixed(2)).toBe("20.00");
  });
  it("a duplicate invoice is the whole total, however many other findings it has", () => {
    expect(invoiceExposure([f("duplicate_invoice", "338.80"), f("tax", "5.00"), f("arithmetic", "9.00")], "338.80").toFixed(2)).toBe("338.80");
  });
  it("never exceeds the invoice total", () => {
    expect(invoiceExposure([f("tax", "400.00"), f("unexpected_fee", "400.00")], "500.00").toFixed(2)).toBe("500.00");
  });
});
