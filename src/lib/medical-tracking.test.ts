import { describe, expect, it } from "vitest";
import { buildMedicalRequest, deadlineState, emptyMedical, insurerGap, needsChecks, nextStep, validateDeadline, validateMedicalPatch } from "./medical-tracking";
import { deadlinesCalendar } from "./calendar";
import { createSeedState } from "./data/seed";
import { parseStoredState } from "./data/validate-state";
import { auditAll, nextActions } from "./data/selectors";
import type { Invoice, MedicalBill } from "./types";

const inv = { vendorName: "City Clinic", number: "B-100", date: "2026-11-01", dueDate: "2026-12-01", total: "250.00", currency: "EUR" } as Pick<Invoice, "vendorName" | "number" | "date" | "dueDate" | "total" | "currency">;
const med = (over: Partial<MedicalBill> = {}): MedicalBill => ({ deadlines: [], ...over });

describe("insurer statement gap", () => {
  it("flags a higher bill without calling it an error, and shows the arithmetic inputs", () => {
    const g = insurerGap(inv, med({ patientResponsibility: "100.00" }), "2026-11-28")!;
    expect(g.kind).toBe("bill_higher");
    expect(g.amount.toFixed(2)).toBe("150.00");
    expect(g.text).toMatch(/worth asking the provider to explain/);
    expect(g.text).toMatch(/Not confirmed/);
  });
  it("says a lower bill may be a payment or adjustment, and a match is a match", () => {
    expect(insurerGap(inv, med({ patientResponsibility: "300.00" }), "2026-11-28")!.text).toMatch(/payment or an adjustment/);
    expect(insurerGap(inv, med({ patientResponsibility: "250.00" }), "2026-11-28")!.kind).toBe("match");
    expect(insurerGap(inv, med(), "2026-11-28")).toBeNull();
  });
  it("warns when the statement is old", () => {
    const g = insurerGap(inv, med({ patientResponsibility: "250.00", statementDate: "2026-01-01" }), "2026-11-28")!;
    expect(g.stale).toBe(true);
    expect(g.text).toMatch(/days old/);
  });
});

describe("the check gate", () => {
  it("holds until both checks are ticked, or the person chooses to pay anyway", () => {
    expect(needsChecks(undefined)).toBe(false);
    expect(needsChecks(med())).toBe(true);
    expect(needsChecks(med({ itemisedReceivedOn: "2026-11-02" }))).toBe(true);
    expect(needsChecks(med({ itemisedReceivedOn: "2026-11-02", statementCheckedOn: "2026-11-03" }))).toBe(false);
    expect(needsChecks(med({ payAnywayOn: "2026-11-03" }))).toBe(false);
  });
  it("gives one next step from what has been recorded", () => {
    expect(nextStep(inv, med(), "2026-11-28").key).toBe("itemised");
    expect(nextStep(inv, med({ itemisedReceivedOn: "2026-11-02" }), "2026-11-28").key).toBe("statement");
    expect(nextStep(inv, med({ itemisedReceivedOn: "2026-11-02", statementCheckedOn: "2026-11-03" }), "2026-11-28").key).toBe("enter_figure");
    expect(nextStep(inv, med({ itemisedReceivedOn: "2026-11-02", statementCheckedOn: "2026-11-03", patientResponsibility: "100" }), "2026-11-28").key).toBe("ask_difference");
  });
});

describe("drafted requests", () => {
  it("leave the account reference to the person, never cite law, and say a hold is only a request", () => {
    const hold = buildMedicalRequest("hold", inv, med(), "Sam");
    expect(hold.message).toContain("[account number]");
    expect(hold.message).toMatch(/request, not a legal demand/);
    expect(hold.message).not.toMatch(/\b(act|statute|law|section|§)\b/i);
    expect(hold.notes.join(" ")).toMatch(/not a legal stay/);
    expect(hold.notes.join(" ")).toMatch(/does not stop the due date/);
    const item = buildMedicalRequest("itemised", inv, med({ forPerson: "Mum", patientResponsibility: "100.00" }), "", { includeStatementFigure: true });
    expect(item.message).toContain("[Your name]");
    expect(item.message).not.toContain("Mum"); // whose bill it is never goes into a draft
    expect(item.message).toMatch(/patient responsibility of/);
  });
});

describe("dates", () => {
  it("need a real date, a label and a source, and report overdue and upcoming correctly", () => {
    expect(validateDeadline({ date: "2026-02-30", label: "x", source: "y" })).toMatch(/valid date/);
    expect(validateDeadline({ date: "2026-12-01", label: "", source: "y" })).toMatch(/what the date is for/);
    expect(validateDeadline({ date: "2026-12-01", label: "Appeal ends", source: "" })).toMatch(/where this date came from/);
    expect(validateDeadline({ date: "2026-12-01", label: "Appeal ends", source: "letter of 3 Nov" })).toBeNull();
    const d = { id: "d1", date: "2026-12-01", label: "Appeal", source: "letter", addedOn: "2026-11-01" };
    expect(deadlineState(d, "2026-11-28").status).toBe("soon");
    expect(deadlineState(d, "2026-12-05").status).toBe("overdue");
    expect(deadlineState(d, "2026-10-01").status).toBe("later");
  });
  it("validates the statement figure and date", () => {
    expect(validateMedicalPatch({ patientResponsibility: "-5" }, "2026-11-28")).toBeTruthy();
    expect(validateMedicalPatch({ patientResponsibility: "abc" }, "2026-11-28")).toBeTruthy();
    expect(validateMedicalPatch({ statementDate: "2027-01-01" }, "2026-11-28")).toBeTruthy();
    expect(validateMedicalPatch({ patientResponsibility: "12.50", statementDate: "2026-11-01" }, "2026-11-28")).toBeNull();
  });
  it("calendar text escapes semicolons and commas", () => {
    const BS = String.fromCharCode(92);
    const ics = deadlinesCalendar([{ id: "d1", date: "2026-12-01", label: "Appeal; ends", source: "letter, dated 3 Nov", title: "Clinic B-1" }]);
    expect(ics).toContain(`Appeal${BS}; ends`);
    expect(ics).toContain(`letter${BS}, dated 3 Nov`);
  });
});

describe("saved data and the dashboard", () => {
  const base = createSeedState();
  const target = base.invoices.find((i) => !i.isCredit && i.paymentStatus === "unpaid")!;
  const withMedical = (m: MedicalBill) => ({ ...base, invoices: base.invoices.map((i) => (i.id === target.id ? { ...i, medical: true } : i)), medicalBills: { [target.id]: m } });
  it("round-trips, drops bad entries and orphans quietly", () => {
    const m = med({ itemisedReceivedOn: "2026-11-02", patientResponsibility: "100.00", deadlines: [{ id: "d1", date: "2026-12-01", label: "Appeal", source: "letter", addedOn: "2026-11-01" }] });
    const ok = parseStoredState(JSON.stringify(withMedical(m)))!;
    expect(ok.state.medicalBills?.[target.id]).toEqual(m);
    const bad = JSON.parse(JSON.stringify(withMedical(m)));
    bad.medicalBills[target.id].patientResponsibility = "-9";
    bad.medicalBills["no-such-invoice"] = med();
    const r = parseStoredState(JSON.stringify(bad))!;
    expect(r.state.medicalBills?.[target.id]).toBeUndefined();
    expect(r.dropped).toBe(1); // the bad entry counts, the orphan does not
    expect(parseStoredState(JSON.stringify(base))!.state.medicalBills).toBeUndefined();
  });
  it("shows an unchecked medical bill and a passed date in the ranked list, once each", () => {
    const s = withMedical(med({ deadlines: [{ id: "d1", date: "2000-01-01", label: "Appeal window ends", source: "letter of 3 Nov", addedOn: "1999-12-01" }] }));
    const list = nextActions(s, auditAll(s));
    expect(list.filter((a) => a.id === `inv:${target.id}`)).toHaveLength(1);
    const d = list.find((a) => a.id === `med:${target.id}:d1`)!;
    expect(d.urgency).toBe("overdue");
    expect(d.reason).toMatch(/Source you gave: letter of 3 Nov/);
  });
});
