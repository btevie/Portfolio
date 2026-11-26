import type { AuditFinding } from "../../types";
import { priorInvoices } from "../history";
import { daysBetween, parseISO } from "../normalize";
import type { Rule } from "../types";
import { makeFinding } from "./util";

export const datesRule: Rule = (inv, ctx) => {
  const out: AuditFinding[] = [];
  const d = parseISO(inv.date), due = parseISO(inv.dueDate), today = parseISO(ctx.today);

  if (d === null || due === null) {
    out.push(makeFinding(inv, {
      ruleId: "dates", key: "invalid",
      classification: "LIKELY_ERROR", severity: "medium",
      title: "An invoice date isn't a valid calendar date",
      explanation: `Invoice date "${inv.date}" or due date "${inv.dueDate}" could not be read as a real date.`,
      expected: "A valid date (YYYY-MM-DD)", actual: `${inv.date} / ${inv.dueDate}`, difference: "—",
      evidence: [`Invoice date: ${inv.date}`, `Due date: ${inv.dueDate}`],
      confidence: "medium", confidenceReason: "A non-existent date cannot be right, but it may be an extraction problem rather than a vendor problem.",
      uncertainty: "The date may have been misread from the document.",
      recommendedAction: "Check the original document and correct the field.",
    }));
    return out;
  }

  if (due < d) {
    out.push(makeFinding(inv, {
      ruleId: "dates", key: "due-before-date",
      classification: "LIKELY_ERROR", severity: "medium",
      title: "Due date is before the invoice date",
      explanation: `The invoice is dated ${inv.date} but is due ${inv.dueDate}, ${Math.abs(daysBetween(d, due))} day(s) earlier.`,
      expected: `On or after ${inv.date}`, actual: inv.dueDate, difference: `${daysBetween(d, due)} days`,
      evidence: [`Invoice date ${inv.date}`, `Due date ${inv.dueDate}`],
      confidence: "high", confidenceReason: "A due date cannot precede the invoice date; this is a logical inconsistency in the document.",
      uncertainty: "It may be a typo (for example the wrong year) rather than an attempt to rush payment.",
      recommendedAction: "Ask the vendor to confirm the correct due date before paying.",
    }));
  }

  if (today !== null && d > today + 86_400_000) {
    out.push(makeFinding(inv, {
      ruleId: "dates", key: "future",
      classification: "REVIEW_NEEDED", severity: "low",
      title: "Invoice is dated in the future",
      explanation: `The invoice date ${inv.date} is after today (${ctx.today}).`,
      expected: `On or before ${ctx.today}`, actual: inv.date, difference: `${daysBetween(today, d)} days ahead`,
      evidence: [`Invoice date ${inv.date}`, `Today ${ctx.today}`],
      confidence: "medium", confidenceReason: "The date is verifiable, but pre-dated invoices are sometimes issued for upcoming periods.",
      uncertainty: "Some vendors invoice in advance.",
      recommendedAction: "Confirm it's an advance invoice before paying early.",
    }));
  }

  const terms = daysBetween(d, due);
  const prior = priorInvoices(inv, ctx);
  if (due >= d && prior.length >= ctx.config.minHistory) {
    const priorTerms = prior.map((p) => { const a = parseISO(p.date), b = parseISO(p.dueDate); return a !== null && b !== null ? daysBetween(a, b) : null; }).filter((x): x is number => x !== null);
    const counts = new Map<number, number>();
    priorTerms.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
    const typical = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (typical !== undefined && Math.abs(terms - typical) >= 7) {
      out.push(makeFinding(inv, {
        ruleId: "dates", key: "terms-change",
        classification: "REVIEW_NEEDED", severity: terms < typical ? "medium" : "low",
        title: "Payment terms changed",
        explanation: `Previous invoices gave ${typical} days to pay; this one gives ${terms}.`,
        expected: `${typical} days`, actual: `${terms} days`, difference: `${terms - typical > 0 ? "+" : ""}${terms - typical} days`,
        evidence: [`Typical terms across ${priorTerms.length} earlier invoices: ${typical} days`, `This invoice: ${inv.date} → ${inv.dueDate}`],
        confidence: priorTerms.length >= 3 ? "high" : "medium",
        confidenceReason: `The terms were consistent across ${priorTerms.length} earlier invoices, so the change is real; whether it's agreed is unknown.`,
        uncertainty: "The vendor may have updated their terms and notified you separately.",
        recommendedAction: "Check your contract. If you didn't agree to shorter terms, ask the vendor to restore them.",
      }));
    }
  }
  return out;
};
