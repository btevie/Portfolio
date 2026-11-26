import type { AuditFinding } from "../../types";
import { D, formatMoney, str2, sum } from "../money";
import { priorInvoices } from "../history";
import type { Rule } from "../types";
import { makeFinding } from "./util";

/** Validates tax against stated rate(s). Supports multiple rates; never assumes a universal VAT rate. */
export const taxRule: Rule = (inv, ctx) => {
  const out: AuditFinding[] = [];
  const lines = inv.lineItems.map((l) => ({ ...l, rate: l.taxRate ?? inv.taxRate }));
  const rated = lines.filter((l) => l.rate !== undefined);
  if (rated.length === 0) return out; // no stated rate → nothing to validate against

  const gross = sum(lines.map((l) => D(l.total)));
  const discount = D(inv.discounts);
  const groups = new Map<string, ReturnType<typeof D>>();
  for (const l of rated) groups.set(l.rate!, (groups.get(l.rate!) ?? D(0)).plus(D(l.total)));

  let expected = D(0);
  const parts: string[] = [];
  for (const [rate, base] of groups) {
    const share = gross.isZero() ? D(0) : discount.times(base).div(gross);
    const taxable = base.minus(share);
    const tax = taxable.times(D(rate)).div(100);
    expected = expected.plus(tax);
    parts.push(`${rate}% on ${str2(taxable)} = ${str2(tax)}`);
  }
  const tol = D(ctx.config.roundingTolerance).times(groups.size + 1);
  const diff = D(inv.taxAmount).minus(expected);
  if (diff.abs().gt(tol)) {
    const m = (v: Parameters<typeof D>[0]) => formatMoney(D(v), inv.currency);
    out.push(makeFinding(inv, {
      ruleId: "tax", key: "amount",
      classification: "LIKELY_ERROR", severity: diff.abs().gte(20) ? "high" : "medium",
      title: "Tax amount doesn't match the stated rate",
      explanation: `Applying the stated tax rate${groups.size > 1 ? "s" : ""} to the taxable amount gives ${m(expected)}, but the invoice charges ${m(inv.taxAmount)}.`,
      expected: m(expected), actual: m(inv.taxAmount), difference: formatMoney(diff, inv.currency),
      evidence: parts,
      confidence: "medium",
      confidenceReason: "The arithmetic is exact, but we only know the rates printed on the invoice.",
      uncertainty: "Some lines may be tax-exempt or reverse-charged without being marked, which would legitimately change the tax amount.",
      recommendedAction: "Ask the vendor which lines are taxable and at what rate, and request a corrected invoice if the amount is wrong.",
      amountAtRisk: diff.gt(0) ? str2(diff) : "0.00",
    }));
  }

  // rate drift versus this vendor's earlier invoices
  const prior = priorInvoices(inv, ctx);
  const last = prior[prior.length - 1];
  const lastRate = last?.taxRate ?? last?.lineItems.find((l) => l.taxRate)?.taxRate;
  const thisRate = inv.taxRate ?? rated[0].rate;
  if (lastRate && thisRate && !D(lastRate).eq(D(thisRate))) {
    out.push(makeFinding(inv, {
      ruleId: "tax", key: "rate-change",
      classification: "REVIEW_NEEDED", severity: "low",
      title: "Tax rate differs from this vendor's previous invoice",
      explanation: `This invoice applies ${thisRate}% tax; the previous invoice from ${inv.vendorName} applied ${lastRate}%.`,
      expected: `${lastRate}%`, actual: `${thisRate}%`, difference: `${D(thisRate).minus(D(lastRate)).toString()} pts`,
      evidence: [`Previous invoice ${last.number}: ${lastRate}%`, `This invoice ${inv.number}: ${thisRate}%`],
      confidence: "medium",
      confidenceReason: "The rates are printed on both invoices; whether the change is justified is unknown.",
      uncertainty: "Tax rates change legitimately (new legislation, different service type or customer location).",
      recommendedAction: "Confirm the applicable rate for this service; no action is needed if the vendor changed it for a known reason.",
    }));
  }
  return out;
};
