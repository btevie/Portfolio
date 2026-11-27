import { D, Decimal, isValidDecimal } from "./audit/money";
import { daysBetween, parseISO } from "./audit/normalize";
import { newId } from "./ids";
import type { ISODate, RecoveryEvent, RecoveryRecord, RecoveryStatus } from "./types";

export const MAX_EVENTS = 200;

export interface CaseFigures {
  claimed: Decimal;
  /** What the vendor has agreed to give back. null = nothing promised yet. */
  promised: Decimal | null;
  /** Credit the user says was applied to their account. */
  applied: Decimal;
  /** Refund money the user says arrived. */
  received: Decimal;
  /** applied + received. */
  resolved: Decimal;
  /** Still to come: the promised amount (or the claim, if nothing is promised) minus what has arrived. Never negative. */
  outstanding: Decimal;
  /** Old records marked "recovered" before amounts were tracked: the whole claim is treated as received. */
  legacy: boolean;
}

const dec = (v: string | undefined) => (v && isValidDecimal(v) ? D(v) : null);

/** All money figures for one case, derived in one place. "Promised", "applied" and "received" are never merged. */
export function caseFigures(r: RecoveryRecord): CaseFigures {
  const claimed = D(r.amount);
  const promised = dec(r.confirmedAmount);
  let applied = dec(r.appliedAmount) ?? D(0);
  let received = dec(r.recoveredAmount) ?? D(0);
  const legacy = r.status === "recovered" && applied.isZero() && received.isZero() && r.recoveredAmount === undefined && r.appliedAmount === undefined;
  if (legacy) received = claimed;
  if (r.status === "dismissed") { applied = D(0); received = D(0); }
  const resolved = applied.plus(received);
  const target = promised ?? claimed;
  const outstanding = r.status === "dismissed" ? D(0) : Decimal.max(target.minus(resolved), 0);
  return { claimed, promised, applied, received, resolved, outstanding, legacy };
}

export type EventInput =
  | { kind: "contacted"; date: ISODate; text: string; followUpDate?: ISODate }
  | { kind: "reply"; date: ISODate; text: string; followUpDate?: ISODate }
  | { kind: "promise"; date?: ISODate; amount: string; text?: string; reference?: string }
  | { kind: "applied" | "received"; date: ISODate; amount: string; text?: string; reference?: string }
  | { kind: "note"; text: string };

export function validateEvent(r: RecoveryRecord, e: EventInput, asOf: ISODate): string | null {
  const dateOk = (d: string | undefined) => d !== undefined && parseISO(d) !== null;
  if (r.status === "dismissed") return "Reopen this case before recording an update.";
  // Chasing a promised refund is the normal follow-up, so contact and replies stay allowed while money is still owed.
  if (r.status === "recovered" && (e.kind === "contacted" || e.kind === "reply")) {
    return "This case is marked as fully recovered. Add a note instead, or record the extra amount you were promised.";
  }
  if ("text" in e && (e.text ?? "").length > 1000) return "Keep the note under 1,000 characters.";
  if ("reference" in e && (e.reference ?? "").length > 120) return "Keep the reference under 120 characters.";
  if (e.kind === "note") return e.text.trim() ? null : "Write a note first.";
  if (e.kind === "contacted" || e.kind === "reply") {
    if (!dateOk(e.date)) return "Enter a valid date.";
    if (e.date > asOf) return "That date is in the future. Record it once it has happened.";
    if (e.followUpDate !== undefined && e.followUpDate !== "" && !dateOk(e.followUpDate)) return "Enter a valid follow-up date.";
    if (e.kind === "reply" && !e.text.trim()) return "Write what the vendor said, even briefly.";
    return null;
  }
  if (!isValidDecimal(e.amount) || D(e.amount).lte(0) || e.amount.trim().startsWith("-")) return "Enter an amount greater than zero.";
  if (e.date !== undefined && e.date !== "" && !dateOk(e.date)) return "Enter a valid date.";
  if (e.kind === "promise") return null;
  if (!dateOk(e.date)) return "Enter a valid date.";
  if (e.date > asOf) return `That date is in the future. Record it once the ${e.kind === "applied" ? "credit is applied" : "money arrives"}.`;
  const f = caseFigures(r);
  const cap = f.promised ?? f.claimed;
  if (f.resolved.plus(D(e.amount)).gt(cap)) return `That would be more than the ${f.promised ? "promised" : "claimed"} ${cap.toFixed(2)}. Record the promised amount first if the vendor agreed to more.`;
  return null;
}

const addDays = (d: ISODate, n: number): ISODate => new Date((parseISO(d) ?? 0) + n * 86_400_000).toISOString().slice(0, 10);

/** Pure: returns the updated record. Callers must validate first. Never discards existing fields. */
export function applyEvent(r: RecoveryRecord, e: EventInput, asOf: ISODate): RecoveryRecord {
  const at = new Date().toISOString();
  const ev = (kind: RecoveryEvent["kind"], text: string, extra: Partial<RecoveryEvent> = {}): RecoveryEvent => ({ id: newId().slice(0, 12), at, kind, text, ...extra });
  const events = [...(r.events ?? [])];
  const startingFigures = caseFigures(r);
  // Older cases represented a full recovery through status alone. Materialize it before a new event can change status.
  let next: RecoveryRecord = { ...r, ...(startingFigures.legacy ? { recoveredAmount: startingFigures.received.toFixed(2) } : {}), updatedAt: asOf };
  const move = (to: RecoveryStatus) => { if (to !== r.status) events.push(ev("status", `Moved to ${to.replace("_", " ")}`, { from: r.status, to })); next.status = to; };
  const early = r.status === "flagged" || r.status === "disputed";

  if (e.kind === "note") events.push(ev("note", e.text.trim()));
  else if (e.kind === "contacted") {
    events.push(ev("disputed", e.text.trim() || "Contacted the vendor", { date: e.date }));
    if (r.status === "flagged") move("disputed");
    next.followUpDate = e.followUpDate || addDays(e.date, 7);
    next.nextStep = "Follow up if the vendor hasn't replied";
  } else if (e.kind === "reply") {
    events.push(ev("vendor_response", e.text.trim(), { date: e.date }));
    if (early) move("vendor_responded");
    next.followUpDate = e.followUpDate || undefined;
    next.nextStep = undefined;
  } else if (e.kind === "promise") {
    const amount = D(e.amount).toFixed(2);
    events.push(ev("credit_issued", e.text?.trim() || "Vendor promised a refund or credit", { amount, reference: e.reference?.trim() || undefined, date: e.date || undefined }));
    next.confirmedAmount = amount;
    next.followUpDate = e.date || r.followUpDate;
    next.nextStep = "Check that it arrives";
    const after = caseFigures({ ...next, status: "credit_issued" });
    if (after.outstanding.lte(0) && after.resolved.gte(after.claimed)) { move("recovered"); next.followUpDate = undefined; next.nextStep = undefined; }
    else if (after.outstanding.lte(0)) {
      if (r.status !== "vendor_responded") move("vendor_responded");
      next.followUpDate = undefined;
      next.nextStep = "Ask the vendor about the remaining claim";
    }
    else move("credit_issued");
  } else {
    const field = e.kind === "applied" ? "appliedAmount" : "recoveredAmount";
    const base = caseFigures(r);
    const amount = D(e.amount);
    events.push(ev(e.kind, e.text?.trim() || (e.kind === "applied" ? "Credit applied to my account" : "Money received"), { amount: amount.toFixed(2), reference: e.reference?.trim() || undefined, date: e.date }));
    const prior = e.kind === "applied" ? base.applied : (base.legacy ? D(0) : base.received);
    next = { ...next, [field]: prior.plus(amount).toFixed(2) };
    const after = caseFigures({ ...next, status: "credit_issued" });
    if (after.outstanding.lte(0) && after.resolved.gte(after.claimed)) { move("recovered"); next.followUpDate = undefined; next.nextStep = undefined; }
    else if (after.outstanding.lte(0)) {
      if (r.status !== "vendor_responded") move("vendor_responded");
      next.followUpDate = undefined;
      next.nextStep = "Ask the vendor about the remaining claim";
    }
    else if (base.promised) { if (r.status !== "credit_issued") move("credit_issued"); next.nextStep = "Waiting for the rest"; }
    else { if (r.status !== "vendor_responded") move("vendor_responded"); next.nextStep = "Confirm what remains outstanding with the vendor"; }
  }
  next.events = events.slice(-MAX_EVENTS);
  return next;
}

export interface NextAction { label: string; due?: ISODate; overdueDays: number; tone: "bad" | "warn" | "info" | "ok" }

/** The single most useful thing to do next, from what the user has recorded. Never invents dates or deadlines. */
export function nextAction(r: RecoveryRecord, asOf: ISODate): NextAction | null {
  if (r.status === "dismissed") return null;
  const f = caseFigures(r);
  const due = r.followUpDate && parseISO(r.followUpDate) !== null ? r.followUpDate : undefined;
  const late = due ? Math.max(0, daysBetween(parseISO(due) ?? 0, parseISO(asOf) ?? 0)) : 0;
  const withDue = (label: string, lateLabel: string): NextAction => ({ label: late > 0 ? lateLabel : label, due, overdueDays: late, tone: late > 0 ? "bad" : "info" });
  switch (r.status) {
    case "flagged": return { label: "Contact the vendor and record it here", overdueDays: 0, tone: "warn" };
    case "disputed": return due ? withDue(`Follow up if no reply by ${due}`, `Follow up now: no reply recorded, due ${due}`) : { label: "Record the vendor's reply when it arrives", overdueDays: 0, tone: "info" };
    case "vendor_responded":
      if (f.promised && f.resolved.gte(f.promised) && f.resolved.lt(f.claimed)) {
        const remaining = f.claimed.minus(f.resolved).toFixed(2);
        return due
          ? withDue(`Ask about ${remaining} not covered by the promise`, `Follow up about ${remaining} not covered by the promise`)
          : { label: `Ask the vendor about ${remaining} still claimed`, overdueDays: 0, tone: "warn" };
      }
      return f.promised ? { label: "Record when the credit is applied or the refund arrives", due, overdueDays: late, tone: late > 0 ? "bad" : "info" } : { label: "Record any promised refund or credit, or dismiss if it was fine", due, overdueDays: late, tone: "warn" };
    case "credit_issued": return withDue(`Check it arrives${due ? ` by ${due}` : ""}: ${f.outstanding.toFixed(2)} still to come`, `Overdue: ${f.outstanding.toFixed(2)} promised for ${due}, not yet recorded as received`);
    case "recovered": return null;
  }
}
