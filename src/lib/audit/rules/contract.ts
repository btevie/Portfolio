import type { AuditFinding } from "../../types";
import { scaled } from "../currency-scale";
import { D, formatMoney, str2 } from "../money";
import { normalizeDescription } from "../normalize";
import type { Rule } from "../types";
import { makeFinding, taxFactor, withTax } from "./util";

export const contractRateRule: Rule = (inv, ctx) => {
  const out: AuditFinding[] = [];
  const rates = ctx.contractRates.filter((r) => r.vendorId === inv.vendorId && r.currency === inv.currency);
  for (const line of inv.lineItems) {
    const desc = normalizeDescription(line.description);
    const rate = rates.find((r) => {
      const match = normalizeDescription(r.match);
      return match.length > 0 && desc.includes(match);
    });
    if (!rate) continue;
    const over = D(line.unitPrice).minus(D(rate.unitPrice));
    if (over.lte(D("0.005"))) continue;
    const overall = over.times(D(line.quantity));
    const m = (v: string) => formatMoney(v, inv.currency);
    out.push(makeFinding(inv, {
      ruleId: "contract_rate", key: `rate-${rate.id}-${line.id}`,
      classification: "LIKELY_ERROR", severity: overall.gte(scaled(100, inv.currency)) ? "high" : "medium",
      title: `Billed above your agreed rate: "${line.description}"`,
      explanation: `You recorded an agreed rate of ${m(rate.unitPrice)} per ${rate.unit}. This line bills ${m(line.unitPrice)} per ${rate.unit} for ${line.quantity} ${rate.unit}(s).`,
      expected: `${m(rate.unitPrice)} / ${rate.unit}`, actual: `${m(line.unitPrice)} / ${rate.unit}`, difference: formatMoney(over, inv.currency, { signed: true }) + ` / ${rate.unit}`,
      evidence: [`Agreed rate (entered by you): ${rate.unitPrice} per ${rate.unit}${rate.note ? ` (${rate.note})` : ""}`, `Invoice line: ${line.quantity} × ${line.unitPrice} = ${line.total}`, `Over-charge across the line: ${str2(overall)}`],
      confidence: "high",
      confidenceReason: "A rate you supplied is directly compared with the rate on the invoice.",
      uncertainty: "This depends on the agreed rate you entered being current and applicable to this work. A newer agreement or a different service tier may apply.",
      recommendedAction: "Send the vendor your agreed rate and ask for a corrected invoice or credit note.",
      amountAtRisk: withTax(overall, taxFactor(inv, line.taxRate)),
    }));
  }

  const exp = ctx.vendor?.expectedAmount;
  const expectedCurrency = ctx.vendor?.expectedCurrency ?? inv.currency;
  if (exp && expectedCurrency === inv.currency && D(exp).gt(0)) {
    const diff = D(inv.total).minus(D(exp));
    if (diff.abs().div(D(exp)).gt("0.01")) {
      const m = (v: string) => formatMoney(v, inv.currency);
      out.push(makeFinding(inv, {
        ruleId: "contract_rate", key: "expected-amount",
        classification: "REVIEW_NEEDED", severity: diff.abs().div(D(exp)).gt("0.1") ? "medium" : "low",
        title: "Total differs from the amount you expect from this vendor",
        explanation: `You set an expected invoice total of ${m(exp)} for ${inv.vendorName}; this invoice is ${m(inv.total)}.`,
        expected: m(exp), actual: m(inv.total), difference: formatMoney(diff, inv.currency, { signed: true }),
        evidence: [`Expected amount (entered by you): ${exp}`, `Invoice total: ${inv.total}`],
        confidence: "medium",
        confidenceReason: "Your expected amount is a firm reference, but it may be out of date.",
        uncertainty: "Usage, seat counts or taxes may have legitimately changed.",
        recommendedAction: "Update your expected amount if the change is intended; otherwise ask the vendor to explain it.",
        amountAtRisk: diff.gt(0) ? str2(diff) : "0.00",
      }));
    }
  }
  return out;
};
