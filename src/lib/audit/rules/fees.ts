import type { AuditFinding } from "../../types";
import { detectBillingTraps } from "../billing-traps";
import { priorInvoices } from "../history";
import { D, formatMoney } from "../money";
import { normalizeDescription } from "../normalize";
import type { Rule } from "../types";
import { makeFinding, taxFactor, withTax } from "./util";

const FEE_WORDS = /\b(fee|surcharge|admin|administration|handling|penalty|late charge|service charge)\b/;

export const unexpectedFeeRule: Rule = (inv, ctx) => {
  const prior = priorInvoices(inv, ctx);
  const known = new Set(prior.flatMap((p) => p.lineItems.map((l) => normalizeDescription(l.description))));
  const out: AuditFinding[] = [];
  const feeShareBase = D(inv.subtotal).plus(D(inv.fees));
  const m = (v: string) => formatMoney(v, inv.currency);

  for (const line of inv.lineItems) {
    if (D(line.total).lte(0)) continue;
    const desc = normalizeDescription(line.description);

    // 1. Check known Dutch/EU/SaaS billing traps (works even on the first invoice!)
    const traps = detectBillingTraps(line.description);
    for (const trap of traps) {
      out.push(makeFinding(inv, {
        ruleId: "unexpected_fee",
        key: `trap-${trap.code}-${line.id}`,
        classification: "REVIEW_NEEDED",
        severity: trap.confidence === "high" ? "medium" : "low",
        title: `${trap.label}: "${line.description}"`,
        explanation: `${trap.reason} (${m(line.total)} billed on this line).`,
        expected: `${m("0")} (verify whether optional or non-compliant)`,
        actual: m(line.total),
        difference: formatMoney(line.total, inv.currency, { signed: true }),
        evidence: [
          `Category: ${trap.category} (${trap.code})`,
          `Line "${line.description}": ${m(line.total)}`,
        ],
        confidence: trap.confidence,
        confidenceReason: `Matched common billing-trap pattern (${trap.category}) on the line description.`,
        uncertainty: "This charge may be valid if you explicitly opted into the add-on or agreed to it in your contract.",
        recommendedAction: trap.action,
        amountAtRisk: withTax(D(line.total), taxFactor(inv, line.taxRate)),
      }));
    }

    // 2. Existing check: new fee line not seen on earlier invoices from this vendor
    if (prior.length === 0 || traps.length > 0) continue;
    const feeLike = line.kind === "fee" || FEE_WORDS.test(desc);
    if (!feeLike || known.has(desc)) continue;
    const share = feeShareBase.isZero() ? D(0) : D(line.total).div(feeShareBase);
    out.push(makeFinding(inv, {
      ruleId: "unexpected_fee",
      key: `${encodeURIComponent(desc).slice(0, 40)}-${line.id}`,
      classification: "REVIEW_NEEDED",
      severity: share.gte("0.05") ? "medium" : "low",
      title: `New fee that wasn't on earlier invoices: "${line.description}"`,
      explanation: `${inv.vendorName} added a ${m(line.total)} charge labelled "${line.description}". None of the ${prior.length} earlier invoices from this vendor include it.`,
      expected: `${m("0")} (no such fee previously)`,
      actual: m(line.total),
      difference: formatMoney(line.total, inv.currency, { signed: true }),
      evidence: [
        `New line: ${line.description}: ${line.total}`,
        `Not present on ${prior.length} earlier invoices (${prior[0].date} to ${prior[prior.length - 1].date})`,
        `Fee is ${share.times(100).toDecimalPlaces(1).toString()}% of subtotal plus stated fees`,
      ],
      confidence: "medium",
      confidenceReason: "It's certain the line is new; it's not certain it is unjustified.",
      uncertainty: "A new fee may be permitted by your agreement, linked to a service you requested, or announced in a notice you didn't see.",
      recommendedAction: "Ask what the fee covers and where it's authorised in your agreement or terms.",
      amountAtRisk: withTax(D(line.total), taxFactor(inv, line.taxRate)),
    }));
  }
  return out;
};
