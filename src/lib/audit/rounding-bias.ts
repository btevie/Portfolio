import type { AuditFinding, Invoice } from "../types";
import { priorInvoices } from "./history";
import { D, formatMoney, str2 } from "./money";
import type { AuditContext } from "./types";
import { makeFinding } from "./rules/util";

/** Exact upper-tail binomial probability P(X >= k) for n fair coin flips (p = 0.5). */
function binomialUpperTailP(n: number, k: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  let comb = 1;
  for (let i = 0; i < k; i++) {
    comb = (comb * (n - i)) / (i + 1);
  }
  for (let i = k; i <= n; i++) {
    sum += comb;
    comb = (comb * (n - i)) / (i + 1);
  }
  return sum * Math.pow(0.5, n);
}

export function roundingBiasFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  const allBills = [...priorInvoices(inv, ctx), inv];
  let upCount = 0;
  let downCount = 0;
  let netBias = D(0);

  for (const bill of allBills) {
    for (const line of bill.lineItems) {
      const qty = D(line.quantity);
      const unit = D(line.unitPrice);
      const billed = D(line.total);
      if (qty.lte(0) || unit.lte(0) || billed.lte(0)) continue;

      const exact = qty.times(unit);
      const diff = billed.minus(exact);
      // Only inspect micro-rounding residuals between 0.001 and 0.05 (larger errors are caught by mathRule)
      if (diff.abs().gte("0.001") && diff.abs().lte("0.05")) {
        if (diff.gt(0)) {
          upCount++;
          netBias = netBias.plus(diff);
        } else {
          downCount++;
          netBias = netBias.plus(diff);
        }
      }
    }
  }

  const totalEvents = upCount + downCount;
  if (totalEvents < 8 || upCount <= downCount || netBias.lte("0.05")) return [];

  const pValue = binomialUpperTailP(totalEvents, upCount);
  if (pValue >= 0.01) return [];

  const m = (v: string) => formatMoney(v, inv.currency);

  return [
    makeFinding(inv, {
      ruleId: "arithmetic",
      key: "binomial-rounding-bias",
      classification: "REVIEW_NEEDED",
      severity: "low",
      title: `Systematic upward rounding bias detected (${upCount}/${totalEvents} lines rounded in vendor's favor)`,
      explanation: `Across ${allBills.length} invoices from ${inv.vendorName}, ${upCount} out of ${totalEvents} sub-cent rounding events rounded upward in the vendor's favor (one-sided binomial p = ${pValue.toFixed(4)} < 0.01), accumulating ${m(str2(netBias))} in silent upward rounding.`,
      expected: "Symmetric ~50/50 rounding (p ≥ 0.01)",
      actual: `${upCount} upward vs ${downCount} downward (p = ${pValue.toFixed(4)})`,
      difference: formatMoney(str2(netBias), inv.currency, { signed: true }),
      evidence: [
        `Upward rounding events (+): ${upCount} · Downward (-): ${downCount}`,
        `Exact binomial tail probability: p = ${pValue.toFixed(4)}`,
        `Cumulative micro-rounding drift: ${formatMoney(str2(netBias), inv.currency, { signed: true })}`,
      ],
      confidence: "high",
      confidenceReason: "Exact one-sided binomial sign test on high-precision quantity × unitPrice residuals.",
      uncertainty: "Some billing systems intentionally apply ceiling rounding per line item.",
      recommendedAction: "Ask the vendor to verify that line-item rounding follows standard half-to-even rules rather than ceiling rounding.",
      amountAtRisk: str2(netBias),
    }),
  ];
}
