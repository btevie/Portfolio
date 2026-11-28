import { describe, expect, it } from "vitest";
import { applyEvent, caseFigures, nextAction, validateEvent, type EventInput } from "./recovery";
import { cleanRecoveryExtras } from "./data/validate-state";
import { recoveryStats } from "./data/selectors";
import type { RecoveryRecord } from "./types";

const base = (over: Partial<RecoveryRecord> = {}): RecoveryRecord => ({
  id: "rec-x", vendorId: "v1", vendorName: "Acme", title: "Duplicate charge", amount: "100.00", currency: "EUR", status: "flagged",
  notes: "", createdAt: "2026-11-01", updatedAt: "2026-11-01", ...over,
});
const run = (r: RecoveryRecord, e: EventInput, asOf = "2026-11-20") => {
  const err = validateEvent(r, e, asOf);
  if (err) throw new Error(err);
  return applyEvent(r, e, asOf);
};

describe("recovery case timeline", () => {
  it("contacting the vendor moves a flagged case to disputed and sets a 7-day follow-up", () => {
    const r = run(base(), { kind: "contacted", date: "2026-11-20", text: "Emailed billing" });
    expect(r.status).toBe("disputed");
    expect(r.followUpDate).toBe("2026-11-27");
    expect(r.events?.map((e) => e.kind)).toEqual(["disputed", "status"]);
  });

  it("keeps partial promises open until the full claim is received", () => {
    let r = run(base({ status: "vendor_responded" }), { kind: "promise", amount: "80", date: "2026-12-01" });
    expect(r.status).toBe("credit_issued");
    expect(caseFigures(r).promised?.toFixed(2)).toBe("80.00");
    r = run(r, { kind: "applied", amount: "30", date: "2026-11-20" });
    expect(r.status).toBe("credit_issued");
    let f = caseFigures(r);
    expect([f.promised?.toFixed(2), f.applied.toFixed(2), f.received.toFixed(2), f.outstanding.toFixed(2)]).toEqual(["80.00", "30.00", "0.00", "50.00"]);
    r = run(r, { kind: "received", amount: "50", date: "2026-11-20", reference: "RF-9" });
    f = caseFigures(r);
    expect(r.status).toBe("vendor_responded");
    expect([f.applied.toFixed(2), f.received.toFixed(2), f.outstanding.toFixed(2)]).toEqual(["30.00", "50.00", "0.00"]);
    expect(caseFigures(r).claimed.minus(f.resolved).toFixed(2)).toBe("20.00");
    expect(nextAction(r, "2026-11-20")?.label).toMatch(/20\.00 still claimed/);
    r = run(r, { kind: "promise", amount: "100" }); // total promised now covers the original claim
    expect(r.status).toBe("credit_issued");
    r = run(r, { kind: "received", amount: "20", date: "2026-11-20", reference: "RF-10" });
    f = caseFigures(r);
    expect(r.status).toBe("recovered");
    expect([f.applied.toFixed(2), f.received.toFixed(2), f.outstanding.toFixed(2)]).toEqual(["30.00", "70.00", "0.00"]);
  });

  it("refuses amounts that are invalid, negative, in the future, or above what was promised", () => {
    const r = run(base({ status: "vendor_responded" }), { kind: "promise", amount: "60" });
    expect(validateEvent(r, { kind: "received", amount: "-5", date: "2026-11-20" }, "2026-11-20")).toMatch(/greater than zero/);
    expect(validateEvent(r, { kind: "received", amount: "abc", date: "2026-11-20" }, "2026-11-20")).toMatch(/greater than zero/);
    expect(validateEvent(r, { kind: "received", amount: "10", date: "2026-12-31" }, "2026-11-20")).toMatch(/future/);
    expect(validateEvent(r, { kind: "received", amount: "61", date: "2026-11-20" }, "2026-11-20")).toMatch(/more than the promised/);
    expect(validateEvent(r, { kind: "contacted", date: "not-a-date", text: "" }, "2026-11-20")).toMatch(/valid date/);
  });

  it("never loses existing data: legacy notes and legacy 'recovered' records still read correctly", () => {
    const legacy = base({ status: "recovered", notes: "Vendor refunded on 26 Nov." });
    const f = caseFigures(legacy);
    expect(f.legacy).toBe(true);
    expect(f.received.toFixed(2)).toBe("100.00");
    expect(f.outstanding.toFixed(2)).toBe("0.00");
    const after = run(base({ notes: "keep me" }), { kind: "note", text: "called" });
    expect(after.notes).toBe("keep me");
  });

  it("next action reflects overdue follow-ups and never invents dates", () => {
    const r = base({ status: "disputed", followUpDate: "2026-11-10" });
    const a = nextAction(r, "2026-11-20")!;
    expect(a.overdueDays).toBe(10);
    expect(a.tone).toBe("bad");
    expect(nextAction(base({ status: "disputed" }), "2026-11-20")!.due).toBeUndefined();
    expect(nextAction(base({ status: "dismissed" }), "2026-11-20")).toBeNull();
  });

  it("stats keep received and applied separate and count only what is still outstanding as potential", () => {
    const r = run(run(base({ status: "vendor_responded" }), { kind: "promise", amount: "80" }), { kind: "applied", amount: "30", date: "2026-11-20" }, "2026-11-20");
    const s = recoveryStats([r], "EUR");
    expect([s.applied.toFixed(2), s.received.toFixed(2), s.recovered.toFixed(2), s.potential.toFixed(2)]).toEqual(["30.00", "0.00", "30.00", "70.00"]);
    expect(s.promisedOutstanding.toFixed(2)).toBe("50.00");
  });

  it("restoring saved data drops malformed tracking fields but keeps the case", () => {
    const dirty = { ...base(), confirmedAmount: "oops", appliedAmount: "-1", followUpDate: "nope", events: [{ id: "e1", at: "2026-11-01T00:00:00Z", kind: "note", text: "ok" }, { id: "e2", at: "bad", kind: "note", text: "x" }, { id: "e3", at: "2026-11-01T00:00:00Z", kind: "hax", text: "x" }] } as unknown as RecoveryRecord;
    const c = cleanRecoveryExtras(dirty);
    expect(c.id).toBe("rec-x");
    expect(c.confirmedAmount).toBeUndefined();
    expect(c.appliedAmount).toBeUndefined();
    expect(c.followUpDate).toBeUndefined();
    expect(c.events).toHaveLength(1);
  });

  it("a further receipt on a legacy recovered case keeps the receipt already counted", () => {
    const legacy = base({ status: "recovered", confirmedAmount: "200.00" });
    const after = run(legacy, { kind: "received", amount: "50", date: "2026-11-20" });
    const f = caseFigures(after);
    expect([f.received.toFixed(2), f.outstanding.toFixed(2)]).toEqual(["150.00", "50.00"]);
  });
});


describe("correcting a mistaken amount", () => {
  it("restores what is outstanding, reopens a case marked recovered, and keeps the earlier entry", () => {
    const r0 = run(base({ status: "vendor_responded", amount: "100.00" }), { kind: "promise", amount: "100" });
    const wrong = run(r0, { kind: "received", date: "2026-11-20", amount: "100" });
    expect(wrong.status).toBe("recovered");
    expect(validateEvent(wrong, { kind: "correct", field: "received", amount: "10", text: "typed 100 instead of 10" }, "2026-11-20")).toBeNull();
    const fixed = run(wrong, { kind: "correct", field: "received", amount: "10", text: "typed 100 instead of 10" });
    expect(caseFigures(fixed).received.toFixed(2)).toBe("10.00");
    expect(caseFigures(fixed).outstanding.toFixed(2)).toBe("90.00");
    expect(fixed.status).toBe("credit_issued");
    expect(fixed.events!.some((e) => e.kind === "received" && e.amount === "100.00")).toBe(true);
    expect(fixed.events!.some((e) => e.kind === "correction")).toBe(true);
  });
  it("needs a reason, refuses negatives and totals above what was promised", () => {
    const r0 = run(base({ status: "vendor_responded", amount: "100.00" }), { kind: "promise", amount: "60" });
    expect(validateEvent(r0, { kind: "correct", field: "received", amount: "5", text: "" }, "2026-11-20")).toMatch(/what was wrong/);
    expect(validateEvent(r0, { kind: "correct", field: "received", amount: "-5", text: "x" }, "2026-11-20")).toMatch(/zero or more/);
    expect(validateEvent(r0, { kind: "correct", field: "received", amount: "61", text: "x" }, "2026-11-20")).toMatch(/more than the promised/);
  });
});
