import type { AuditFinding } from "../../types";
import { priorInvoices } from "../history";
import { D, formatMoney } from "../money";
import { normalizeDescription } from "../normalize";
import type { Rule } from "../types";
import { makeFinding, taxFactor, withTax } from "./util";

const FEE_WORDS = /\b(fee|surcharge|admin|administration|handling|penalty|late charge|service charge)\b/;

export const unexpectedFeeRule: Rule = (inv, ctx) => {
  const prior = priorInvoices(inv, ctx);
  if (prior.length === 0) return []; // nothing to compare against
  const known = new Set(prior.flatMap((p) => p.lineItems.map((l) => normalizeDescription(l.description))));
  const out: AuditFinding[] = [];
  const feeShareBase = D(inv.subtotal).plus(D(inv.fees));
  for (const line of inv.lineItems) {
    const desc = normalizeDescription(line.description);
    const feeLike = line.kind === "fee" || FEE_WORDS.test(desc);
    if (!feeLike || known.has(desc) || D(line.total).lte(0)) continue;
    const share = feeShareBase.isZero() ? D(0) : D(line.total).div(feeShareBase);
    const m = (v: string) => formatMoney(v, inv.currency);
    out.push(makeFinding(inv, {
      ruleId: "unexpected_fee", key: `${encodeURIComponent(desc).slice(0, 40)}-${line.id}`,
      classification: "REVIEW_NEEDED", severity: share.gte("0.05") ? "medium" : "low",
      title: `New fee that wasn't on earlier invoices: "${line.description}"`,
      explanation: `${inv.vendorName} added a ${m(line.total)} charge labelled "${line.description}". None of the ${prior.length} earlier invoices from this vendor include it.`,
      expected: `${m("0")} (no such fee previously)`, actual: m(line.total), difference: formatMoney(line.total, inv.currency, { signed: true }),
      evidence: [`New line: ${line.description}: ${line.total}`, `Not present on ${prior.length} earlier invoices (${prior[0].date} to ${prior[prior.length - 1].date})`, `Fee is ${share.times(100).toDecimalPlaces(1).toString()}% of subtotal plus stated fees`],
      confidence: "medium",
      confidenceReason: "It's certain the line is new; it's not certain it is unjustified.",
      uncertainty: "A new fee may be permitted by your agreement, linked to a service you requested, or announced in a notice you didn't see.",
      recommendedAction: "Ask what the fee covers and where it's authorised in your agreement or terms.",
      amountAtRisk: withTax(D(line.total), taxFactor(inv, line.taxRate)),
    }));
  }
  return out;
};
