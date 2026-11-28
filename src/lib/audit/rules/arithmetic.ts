import type { AuditFinding } from "../../types";
import { scaled } from "../currency-scale";
import type { Invoice } from "../../types";
import { D, Decimal, formatMoney, round2, str2, sum } from "../money";
import type { Rule } from "../types";
import { makeFinding, taxFactor, weightedTaxFactor, withTax } from "./util";

const m = (v: Decimal.Value, inv: Invoice) => formatMoney(v, inv.currency);

export const arithmeticRule: Rule = (inv, ctx) => {
  const tol = D(ctx.config.roundingTolerance);
  const out: AuditFinding[] = [];

  // 1. quantity × unit price = line total
  for (const line of inv.lineItems) {
    const expected = round2(D(line.quantity).times(D(line.unitPrice)));
    const diff = D(line.total).minus(expected);
    if (diff.abs().gt(tol)) {
      const over = diff.gt(0);
      out.push(makeFinding(inv, {
        ruleId: "arithmetic",
        key: `line-${line.id}`,
        classification: "LIKELY_ERROR",
        severity: diff.abs().gte(scaled(50, inv.currency)) ? "high" : "medium",
        title: `Line total doesn't match quantity × price: "${line.description}"`,
        explanation: `${line.quantity} × ${m(line.unitPrice, inv)} should come to ${m(expected, inv)}, but the line shows ${m(line.total, inv)}. ${over ? "The line is higher than its own inputs support." : "The line is lower than its own inputs support."}`,
        expected: m(expected, inv),
        actual: m(line.total, inv),
        difference: m(diff, inv, ),
        evidence: [`Line "${line.description}": quantity ${line.quantity}, unit price ${line.unitPrice}, stated total ${line.total}`, `Recalculated with decimal arithmetic: ${line.quantity} × ${line.unitPrice} = ${str2(expected)}`],
        confidence: "high",
        confidenceReason: "This is pure arithmetic on numbers printed on the invoice itself, so no outside data is involved.",
        uncertainty: "The printed quantity or unit price may be the part that is wrong rather than the total, or the vendor may bill a minimum charge not shown on the invoice.",
        recommendedAction: "Ask the vendor to confirm the quantity and unit price for this line and to reissue the invoice if the total is wrong.",
        amountAtRisk: over ? withTax(diff, taxFactor(inv, line.taxRate)) : "0.00",
      }));
    }
  }

  // 2. sum of item lines = subtotal, sum of fee lines = fees
  const itemSum = sum(inv.lineItems.filter((l) => l.kind === "item").map((l) => D(l.total)));
  const subDiff = D(inv.subtotal).minus(itemSum);
  if (subDiff.abs().gt(tol)) {
    out.push(makeFinding(inv, {
      ruleId: "arithmetic", key: "subtotal",
      classification: "LIKELY_ERROR", severity: "high",
      title: "Line items don't add up to the stated subtotal",
      explanation: `The item lines add up to ${m(itemSum, inv)}, but the invoice states a subtotal of ${m(inv.subtotal, inv)}.`,
      expected: m(itemSum, inv), actual: m(inv.subtotal, inv), difference: m(subDiff, inv),
      evidence: inv.lineItems.filter((l) => l.kind === "item").map((l) => `${l.description}: ${l.total}`),
      confidence: "high",
      confidenceReason: "Re-adding the printed line totals is exact arithmetic.",
      uncertainty: "A line may be missing from the extracted data, or the subtotal may include items printed elsewhere on the document.",
      recommendedAction: "Check the original document for a missing line, then ask the vendor to explain the difference.",
      amountAtRisk: subDiff.gt(0) ? withTax(subDiff, weightedTaxFactor(inv.lineItems.filter((l) => l.kind === "item"), inv.taxRate)) : "0.00",
    }));
  }
  const feeSum = sum(inv.lineItems.filter((l) => l.kind === "fee").map((l) => D(l.total)));
  const feeDiff = D(inv.fees).minus(feeSum);
  if (feeDiff.abs().gt(tol)) {
    out.push(makeFinding(inv, {
      ruleId: "arithmetic", key: "fees",
      classification: "LIKELY_ERROR", severity: "medium",
      title: "Fee lines don't add up to the stated fees",
      explanation: `Fee lines total ${m(feeSum, inv)} but the invoice states fees of ${m(inv.fees, inv)}.`,
      expected: m(feeSum, inv), actual: m(inv.fees, inv), difference: m(feeDiff, inv),
      evidence: inv.lineItems.filter((l) => l.kind === "fee").map((l) => `${l.description}: ${l.total}`),
      confidence: "high", confidenceReason: "Re-adding printed fee lines is exact arithmetic.",
      uncertainty: "Some fees may be printed outside the itemised lines.",
      recommendedAction: "Ask the vendor to itemise all fees.",
      amountAtRisk: feeDiff.gt(0) ? withTax(feeDiff, weightedTaxFactor(inv.lineItems.filter((l) => l.kind === "fee"), inv.taxRate)) : "0.00",
    }));
  }

  // 3. subtotal − discounts + tax + fees = total
  const expectedTotal = D(inv.subtotal).minus(D(inv.discounts)).plus(D(inv.taxAmount)).plus(D(inv.fees));
  const totDiff = D(inv.total).minus(expectedTotal);
  if (totDiff.abs().gt(tol)) {
    out.push(makeFinding(inv, {
      ruleId: "arithmetic", key: "total",
      classification: "LIKELY_ERROR", severity: "high",
      title: "Total doesn't equal subtotal − discounts + tax + fees",
      explanation: `Subtotal ${m(inv.subtotal, inv)} − discounts ${m(inv.discounts, inv)} + tax ${m(inv.taxAmount, inv)} + fees ${m(inv.fees, inv)} = ${m(expectedTotal, inv)}, but the invoice total is ${m(inv.total, inv)}.`,
      expected: m(expectedTotal, inv), actual: m(inv.total, inv), difference: m(totDiff, inv),
      evidence: [`Subtotal ${inv.subtotal}`, `Discounts ${inv.discounts}`, `Tax ${inv.taxAmount}`, `Fees ${inv.fees}`, `Stated total ${inv.total}`],
      confidence: "high",
      confidenceReason: "The components and the total are all printed on the invoice; the check is exact arithmetic.",
      uncertainty: "A charge or credit may appear on the document that wasn't captured in the extracted fields (for example a prior-balance carry-over).",
      recommendedAction: "Compare against the original document and ask the vendor to reconcile the total before you pay.",
      amountAtRisk: totDiff.gt(0) ? str2(totDiff) : "0.00",
    }));
  }
  return out;
};
