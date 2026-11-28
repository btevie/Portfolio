import type { AuditFinding, Invoice } from "../types";
import { scaled } from "./currency-scale";
import { priorInvoices } from "./history";
import { D, formatMoney, str2 } from "./money";
import { normalizeDescription } from "./normalize";
import type { AuditContext } from "./types";
import { makeFinding, taxFactor, withTax } from "./rules/util";

function quartile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

export function unitDecompositionFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  const out: AuditFinding[] = [];
  const prior = priorInvoices(inv, ctx);
  if (prior.length < 2) return out;

  const m = (v: string) => formatMoney(v, inv.currency);

  for (const line of inv.lineItems) {
    const qty = D(line.quantity);
    const total = D(line.total);
    if (qty.lte(0) || total.lte(0)) continue;

    const effUnit = total.div(qty);
    const normDesc = normalizeDescription(line.description);
    if (normDesc.length < 3) continue;

    // Gather historical unit rates and quantities for the exact same line description
    const history: { qty: number; unit: number; total: number; invNum: string }[] = [];
    for (const p of prior) {
      for (const pl of p.lineItems) {
        if (normalizeDescription(pl.description) === normDesc && D(pl.quantity).gt(0) && D(pl.total).gt(0)) {
          const u = Number(D(pl.total).div(D(pl.quantity)).toFixed(4));
          history.push({ qty: Number(D(pl.quantity).toFixed(4)), unit: u, total: Number(D(pl.total).toFixed(2)), invNum: p.number });
        }
      }
    }

    if (history.length < 2) continue;

    const lastMatch = history[history.length - 1];
    const oldUnit = D(lastMatch.unit.toFixed(4));
    const oldQty = D(lastMatch.qty.toFixed(4));

    // Only trigger when BOTH quantity changed AND effective unit rate rose > 3%
    // (pure quantity-unchanged hikes are already caught by line-compare)
    if (qty.eq(oldQty) || effUnit.lte(oldUnit.times("1.03"))) continue;

    const sortedUnits = history.map((h) => h.unit).sort((a, b) => a - b);
    const q1 = quartile(sortedUnits, 0.25);
    const q3 = quartile(sortedUnits, 0.75);
    const iqr = q3 - q1;
    const upperFence = q3 + 1.5 * iqr;

    if (Number(effUnit.toFixed(4)) <= upperFence && history.length >= 3) continue;

    const priceVariance = qty.times(effUnit.minus(oldUnit));
    const volumeVariance = qty.minus(oldQty).times(oldUnit);
    if (priceVariance.lt(scaled(5, inv.currency))) continue;

    out.push(
      makeFinding(inv, {
        ruleId: "price_history",
        key: `pvm-tukey-${line.id}`,
        classification: "REVIEW_NEEDED",
        severity: priceVariance.gte(scaled(50, inv.currency)) ? "medium" : "low",
        title: `Hidden unit-rate hike (+${m(str2(priceVariance))}) masked by quantity change on "${line.description}"`,
        explanation: `Quantity changed from ${oldQty.toString()} to ${qty.toString()}, while the effective unit rate rose from ${m(str2(oldUnit))} to ${m(str2(effUnit))}. Decomposing the total change shows ${formatMoney(str2(volumeVariance), inv.currency, { signed: true })} from volume change and +${m(str2(priceVariance))} from an unannounced unit-rate increase.`,
        expected: `${m(str2(oldUnit))} / unit (Tukey upper fence: ${m(str2(D(upperFence.toFixed(2))))})`,
        actual: `${m(str2(effUnit))} / unit`,
        difference: formatMoney(str2(priceVariance), inv.currency, { signed: true }),
        evidence: [
          `Previous (${lastMatch.invNum}): ${oldQty.toString()} × ${m(str2(oldUnit))} = ${m(str2(D(lastMatch.total.toFixed(2))))}`,
          `Current (${inv.number}): ${qty.toString()} × ${m(str2(effUnit))} = ${m(str2(total))}`,
          `Volume variance: ${formatMoney(str2(volumeVariance), inv.currency, { signed: true })} · Pure price variance: +${m(str2(priceVariance))}`,
        ],
        confidence: "high",
        confidenceReason: "Separates volume variance from unit-price variance using non-parametric Tukey IQR fences.",
        uncertainty: "Tiered volume pricing or loss of a bulk discount can legitimately raise the per-unit price when quantity drops.",
        recommendedAction: `Confirm whether the per-unit rate change from ${m(str2(oldUnit))} to ${m(str2(effUnit))} was agreed.`,
        amountAtRisk: withTax(priceVariance, taxFactor(inv, line.taxRate)),
      })
    );
  }

  return out;
}
