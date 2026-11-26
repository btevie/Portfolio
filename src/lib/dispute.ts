import { D, formatMoney } from "./audit/money";
import { fmtDate } from "./format";
import type { AuditFinding, FindingDecision, Invoice } from "./types";

/**
 * Drafts a polite clarification/dispute note. Nothing is ever sent — the user edits and copies it.
 * Wording is deliberately hedged for unconfirmed anomalies and firmer only after the user confirms.
 */
export function draftNote(invoice: Invoice, findings: AuditFinding[], decisions: Record<string, FindingDecision>, senderName: string): string {
  const confirmed = findings.some((f) => decisions[f.id] === "confirmed");
  const total = findings.reduce((a, f) => a.plus(D(f.amountAtRisk)), D(0));
  const lines = findings.map((f, i) => {
    const firm = decisions[f.id] === "confirmed";
    return [
      `${i + 1}. ${f.title}`,
      `   ${firm ? "Our records show" : "It appears that"}: ${f.explanation}`,
      `   Expected: ${f.expected} · Invoiced: ${f.actual} · Difference: ${f.difference}`,
      `   Request: ${f.recommendedAction}`,
    ].join("\n");
  });
  return [
    `Subject: ${confirmed ? "Query on" : "Clarification requested for"} invoice ${invoice.number} (${fmtDate(invoice.date)})`,
    "",
    `Hello ${invoice.vendorName} team,`,
    "",
    `I'm reviewing invoice ${invoice.number} dated ${fmtDate(invoice.date)} for ${formatMoney(invoice.total, invoice.currency)}, and ${confirmed ? "found" : "noticed"} ${findings.length === 1 ? "an item" : `${findings.length} items`} I'd like to ${confirmed ? "resolve" : "understand"} before payment:`,
    "",
    ...lines.flatMap((l) => [l, ""]),
    ...(total.gt(0) ? [`The amount in question is up to ${formatMoney(total, invoice.currency)} including tax.`, ""] : []),
    `Could you please ${confirmed ? "review these points and issue a corrected invoice or credit note where appropriate" : "confirm whether these are correct, and share a corrected invoice if they are not"}? I'll hold payment of the disputed amount until I hear back, and I'm happy to share my records.`,
    "",
    "Thank you,",
    senderName,
  ].join("\n");
}
