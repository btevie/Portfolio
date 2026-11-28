import { D, Decimal, formatMoney, isValidDecimal } from "./audit/money";
import { daysBetween, parseISO } from "./audit/normalize";
import { fmtDate } from "./format";
import type { Invoice, ISODate, MedicalBill, MedicalDeadline } from "./types";

/**
 * Medical-bill tracking. Everything here is something the user recorded; nothing is read from an insurer and nothing is
 * sent anywhere. "Checked" means "the user says they looked at that document", never "the bill is correct". Drafted
 * requests are text for the user to send themselves, and they contain no diagnosis, patient name or account number.
 */
export const STALE_STATEMENT_DAYS = 90;
export const emptyMedical = (): MedicalBill => ({ deadlines: [] });

export const CHECKS = [
  { key: "itemised", field: "itemisedReceivedOn", short: "itemised bill not received yet", label: "I received an itemised bill", why: "It lists each service and its code, so you can see what you are being charged for." },
  { key: "statement", field: "statementCheckedOn", short: "insurer statement not matched yet", label: "I matched my insurer's statement to this bill", why: "The insurer's statement (EOB) says what you are responsible for. It is not a bill." },
] as const;

export const missingChecks = (m: MedicalBill): string[] => CHECKS.filter((c) => !m[c.field]).map((c) => c.label);
export const missingShort = (m: MedicalBill): string[] => CHECKS.filter((c) => !m[c.field]).map((c) => c.short);
export const allChecked = (m: MedicalBill) => missingChecks(m).length === 0;
/** A medical bill waits in the pay run until both checks are ticked, or the user chooses to pay anyway. */
export const needsChecks = (m: MedicalBill | undefined) => Boolean(m) && !allChecked(m!) && !m!.payAnywayOn;

export interface Gap {
  kind: "bill_higher" | "bill_lower" | "match";
  /** Always positive: how far apart the bill and the statement figure are. */
  amount: Decimal;
  statementAgeDays: number | null;
  stale: boolean;
  text: string;
}

/** Bill total against "patient responsibility" from the insurer's statement. A comparison of two numbers the user gave, in one currency. */
export function insurerGap(inv: Pick<Invoice, "total" | "currency">, m: MedicalBill, asOf: ISODate): Gap | null {
  if (!m.patientResponsibility || !isValidDecimal(m.patientResponsibility)) return null;
  const owed = D(m.patientResponsibility), total = D(inv.total);
  const diff = total.minus(owed);
  const age = m.statementDate && parseISO(m.statementDate) !== null && parseISO(asOf) !== null ? daysBetween(parseISO(m.statementDate)!, parseISO(asOf)!) : null;
  const stale = age !== null && age > STALE_STATEMENT_DAYS;
  const money = (v: Decimal) => formatMoney(v, inv.currency);
  const staleNote = stale ? ` Your statement is ${age} days old, so the figures may have changed.` : "";
  if (diff.abs().lte("0.005")) return { kind: "match", amount: D(0), statementAgeDays: age, stale, text: `The bill and the patient responsibility on your insurer statement match (${money(total)}).${staleNote}` };
  if (diff.gt(0)) return { kind: "bill_higher", amount: diff, statementAgeDays: age, stale, text: `The bill asks for ${money(total)}, which is ${money(diff)} more than the patient responsibility on your insurer statement (${money(owed)}). That can be a deductible, coinsurance, a later adjustment or a mistake, so it is worth asking the provider to explain. Not confirmed.${staleNote}` };
  return { kind: "bill_lower", amount: diff.abs(), statementAgeDays: age, stale, text: `The bill is ${money(diff.abs())} lower than the patient responsibility on your insurer statement (${money(owed)}). That may reflect a payment or an adjustment.${staleNote}` };
}

export type NextStepKey = "itemised" | "statement" | "enter_figure" | "ask_difference" | "pay_or_note";
export interface NextStep { key: NextStepKey; title: string; detail: string }

/** One next step, worked out from what the user has recorded. */
export function nextStep(inv: Pick<Invoice, "total" | "currency">, m: MedicalBill, asOf: ISODate): NextStep {
  if (!m.itemisedReceivedOn) return { key: "itemised", title: "Ask for an itemised bill", detail: "It lists every service and its code. Without it, the total cannot be checked." };
  if (!m.statementCheckedOn) return { key: "statement", title: "Match your insurer's statement to this bill", detail: "Find the statement (EOB) for this visit. It says what you are responsible for. It is not a bill." };
  const gap = insurerGap(inv, m, asOf);
  if (!gap) return { key: "enter_figure", title: "Enter what your insurer's statement says you owe", detail: "Look for \"patient responsibility\". Overbill compares it with the bill." };
  if (gap.kind === "bill_higher") return { key: "ask_difference", title: "Ask the provider to explain the difference", detail: "The bill is higher than the patient responsibility on your statement. The comparison is below." };
  return { key: "pay_or_note", title: "Pay what you have confirmed, and note any deadlines", detail: "Add any dates from letters below, with where each came from." };
}

export type DeadlineStatus = "overdue" | "soon" | "later";
export function deadlineState(d: MedicalDeadline, asOf: ISODate, soonDays = 7): { days: number; status: DeadlineStatus } {
  const days = daysBetween(parseISO(asOf) ?? 0, parseISO(d.date) ?? 0);
  return { days, status: days < 0 ? "overdue" : days <= soonDays ? "soon" : "later" };
}
export const deadlineWhen = (days: number) => days < 0 ? `${-days} day${days === -1 ? "" : "s"} ago` : days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`;

export interface DeadlineInput { date: string; label: string; source: string }
/** A deadline always carries where it came from. Overbill never works one out. */
export function validateDeadline(i: DeadlineInput): string | null {
  if (parseISO(i.date) === null) return "Enter a valid date.";
  if (!i.label.trim()) return "Say what the date is for, for example \"appeal window ends\".";
  if (!i.source.trim()) return "Say where this date came from, for example \"collection letter dated 3 Nov\". Overbill does not work dates out for you.";
  if (i.label.length > 120 || i.source.length > 200) return "Keep the label under 120 and the source under 200 characters.";
  return null;
}

export function validateMedicalPatch(p: Partial<MedicalBill>, asOf: ISODate): string | null {
  if (p.patientResponsibility !== undefined && p.patientResponsibility !== "" && (!isValidDecimal(p.patientResponsibility) || p.patientResponsibility.trim().startsWith("-"))) return "Enter the patient responsibility as an amount, like 120.50.";
  if (p.statementDate && (parseISO(p.statementDate) === null || p.statementDate > asOf)) return "Enter the date printed on the statement (not in the future).";
  if (p.forPerson !== undefined && p.forPerson.length > 60) return "Keep the name under 60 characters.";
  return null;
}

export type RequestKind = "itemised" | "hold";
export interface MedicalRequest { subject: string; message: string; /** Shown next to the draft, not part of it. */ notes: string[] }

/**
 * Drafts a request for the user to send. No diagnosis, patient name or account number is included: the user fills in the
 * placeholder. It is a request, never a legal demand, and it does not cite any law.
 */
export function buildMedicalRequest(kind: RequestKind, inv: Pick<Invoice, "vendorName" | "number" | "date" | "dueDate" | "total" | "currency">, m: MedicalBill, sender: string, opts: { includeStatementFigure?: boolean } = {}): MedicalRequest {
  const money = (v: string) => formatMoney(v, inv.currency);
  const ref = `bill ${inv.number} dated ${fmtDate(inv.date)} for ${money(inv.total)}`;
  const figure = opts.includeStatementFigure && m.patientResponsibility ? [`My insurer's statement shows patient responsibility of ${money(m.patientResponsibility)}${m.statementDate ? ` (statement dated ${fmtDate(m.statementDate)})` : ""}, so I would like to understand the difference.`] : [];
  const close = ["Thank you,", sender.trim() || "[Your name]"];
  if (kind === "itemised") {
    return {
      subject: `Request for an itemised bill: ${inv.number}`,
      message: ["Hello,", "", `I received ${ref}. My account reference is [account number].`, "", "Could you please send an itemised bill that shows each service, its billing code, the date of service and the amount charged, together with any insurance payments or adjustments that have been applied?", ...(figure.length ? ["", ...figure] : []), "", "I would like to review it before paying.", "", ...close].join("\n"),
      notes: ["Fill in your account reference yourself. The draft has no patient name, diagnosis or account number.", "Overbill never sends this. Send it through the provider's usual channel."],
    };
  }
  return {
    subject: `Request to hold account while a bill is reviewed: ${inv.number}`,
    message: ["Hello,", "", `I am reviewing ${ref}. My account reference is [account number].`, "", "I have asked, or am asking, for an itemised bill and I am checking it against my insurer's statement.", ...(figure.length ? ["", ...figure] : []), "", `Could you please put this account on hold, and not refer it to a collection agency, while I complete my review? The due date is ${fmtDate(inv.dueDate)}. I will pay any amount I confirm is owed, and I will contact you again by [date].`, "", "This is a request, not a legal demand. Please confirm in writing what you are able to do.", "", ...close].join("\n"),
      notes: ["A hold is a request, not a legal stay. The provider may refuse, and this does not stop the due date.", "If you can, pay any part you have already confirmed is owed.", "Overbill never sends this. Fill in the account reference and date yourself."],
    };
}

/** Plain-language meanings. Not legal or medical advice, and not specific to any country or plan. */
export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: "EOB (explanation of benefits)", meaning: "A statement from your insurer about a claim. It says what was charged, what the insurer paid, and what you are responsible for. It is not a bill." },
  { term: "Patient responsibility", meaning: "The part of the charge your insurer's statement says you pay yourself." },
  { term: "Itemised bill", meaning: "A bill that lists each service with its code, date and price, not just a total." },
  { term: "Allowed amount", meaning: "The price your insurer agreed with an in-network provider. Providers often write off the rest." },
  { term: "Deductible", meaning: "What you pay yourself each year before your insurance starts paying its share." },
  { term: "Coinsurance", meaning: "Your percentage share of a covered cost after the deductible, for example 20%." },
  { term: "Copay", meaning: "A fixed amount you pay for a visit or service." },
  { term: "Out-of-network", meaning: "A provider without an agreed price with your insurer. Bills can be higher, so check what your plan says." },
  { term: "Balance billing", meaning: "When a provider bills you for the difference between its charge and what your insurer allowed. Whether that is permitted depends on your plan and where you live." },
  { term: "Billing code (CPT, HCPCS)", meaning: "A short code for a service. The same code twice on one bill is worth asking about, since it may be correct." },
  { term: "Collections", meaning: "When a provider passes an unpaid bill to a collection agency. Ask the provider what stage your bill is at." },
];
