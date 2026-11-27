import type { AuditFinding, Invoice } from "../types";
import { priorInvoices } from "./history";
import { D, Decimal, formatMoney, str2 } from "./money";
import type { AuditContext } from "./types";
import { makeFinding, taxFactor, withTax } from "./rules/util";

// Expected Benford's Law first-digit probabilities (digits 1..9)
const BENFORD_EXPECTED: Record<number, number> = {
  1: 0.30103,
  2: 0.17609,
  3: 0.12494,
  4: 0.09691,
  5: 0.07918,
  6: 0.06695,
  7: 0.05799,
  8: 0.05115,
  9: 0.04576,
};

export interface VendorForensicProfile {
  invoiceCount: number;
  meanNet: string;
  stdDevNet: string;
  volatilityPct: number;
  roundNumberRatio: number;
  benfordChiSquare: number | null;
  anomalyLabel: "Consistent" | "Moderate variance" | "High forensic variance";
}

function leadingDigit(val: Decimal): number | null {
  const s = val.abs().toFixed(2).replace(/^0+|\./g, "");
  const d = Number(s[0]);
  return d >= 1 && d <= 9 ? d : null;
}

function isRoundHundredOrFifty(val: Decimal): boolean {
  if (val.lt(100)) return false;
  return val.mod(50).isZero();
}

export function analyzeVendorForensics(invoices: Invoice[]): VendorForensicProfile {
  const valid = invoices.filter((i) => !i.isCredit && i.extraction !== "mock");
  const nets = valid.map((i) => D(i.subtotal).minus(D(i.discounts))).filter((n) => n.gt(0));
  const count = nets.length;

  if (count === 0) {
    return {
      invoiceCount: 0,
      meanNet: "0.00",
      stdDevNet: "0.00",
      volatilityPct: 0,
      roundNumberRatio: 0,
      benfordChiSquare: null,
      anomalyLabel: "Consistent",
    };
  }

  const total = nets.reduce((acc, v) => acc.plus(v), D(0));
  const mean = total.div(count);
  const variance =
    count > 1
      ? nets.reduce((acc, v) => acc.plus(v.minus(mean).pow(2)), D(0)).div(count - 1)
      : D(0);
  const stdDev = variance.sqrt();
  const volatilityPct = mean.gt(0) ? Number(stdDev.div(mean).times(100).toFixed(1)) : 0;

  const allLineAmounts = valid.flatMap((i) => i.lineItems.map((l) => D(l.total))).filter((v) => v.gt(0));
  const roundCount = allLineAmounts.filter(isRoundHundredOrFifty).length;
  const roundNumberRatio = allLineAmounts.length > 0 ? Number((roundCount / allLineAmounts.length).toFixed(2)) : 0;

  // Benford's Law chi-square test across line-item amounts when sample >= 12
  let benfordChiSquare: number | null = null;
  if (allLineAmounts.length >= 12) {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    let nDigits = 0;
    for (const amt of allLineAmounts) {
      const d = leadingDigit(amt);
      if (d !== null) {
        counts[d]++;
        nDigits++;
      }
    }
    if (nDigits >= 12) {
      let chi2 = 0;
      for (let d = 1; d <= 9; d++) {
        const exp = BENFORD_EXPECTED[d] * nDigits;
        chi2 += Math.pow(counts[d] - exp, 2) / exp;
      }
      benfordChiSquare = Number(chi2.toFixed(2));
    }
  }

  const highForensic = volatilityPct > 35 || roundNumberRatio >= 0.6 || (benfordChiSquare !== null && benfordChiSquare > 15.51);
  const modForensic = volatilityPct > 18 || roundNumberRatio >= 0.35 || (benfordChiSquare !== null && benfordChiSquare > 11.07);

  return {
    invoiceCount: count,
    meanNet: str2(mean),
    stdDevNet: str2(stdDev),
    volatilityPct,
    roundNumberRatio,
    benfordChiSquare,
    anomalyLabel: highForensic ? "High forensic variance" : modForensic ? "Moderate variance" : "Consistent",
  };
}

export function forensicAuditFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  const out: AuditFinding[] = [];
  const prior = priorInvoices(inv, ctx);
  const m = (v: string | Decimal) => formatMoney(v, inv.currency);

  // 1. Z-Score (>2.5σ) statistical spike against vendor's historical variance
  if (prior.length >= 4 && ctx.vendor?.billing !== "variable") {
    const profile = analyzeVendorForensics(prior);
    const mean = D(profile.meanNet);
    const stdDev = D(profile.stdDevNet);
    const currentNet = D(inv.subtotal).minus(D(inv.discounts));

    if (stdDev.gt(0) && currentNet.gt(mean)) {
      const zScore = currentNet.minus(mean).div(stdDev);
      if (zScore.gte("2.5")) {
        const excess = currentNet.minus(mean);
        out.push(makeFinding(inv, {
          ruleId: "price_history",
          key: "forensic-zscore",
          classification: "REVIEW_NEEDED",
          severity: zScore.gte("3.5") ? "high" : "medium",
          title: `Statistical outlier (${zScore.toFixed(1)}σ above ${inv.vendorName}'s normal variance)`,
          explanation: `This invoice's net amount (${m(currentNet)}) sits ${zScore.toFixed(1)} standard deviations above ${inv.vendorName}'s historical mean of ${m(mean)} (±${m(stdDev)}). Statistically, less than 1% of normal bills fall this far outside a vendor's baseline.`,
          expected: `${m(mean)} (±${m(stdDev)})`,
          actual: m(currentNet),
          difference: formatMoney(str2(excess), inv.currency, { signed: true }),
          evidence: [
            `Historical mean across ${prior.length} bills: ${m(mean)}`,
            `Sample standard deviation (1σ): ${m(stdDev)}`,
            `Z-score deviation: +${zScore.toFixed(2)}σ`,
          ],
          confidence: "high",
          confidenceReason: "Measured directly from this vendor's multi-invoice mean and sample standard deviation.",
          uncertainty: "A one-off project milestone, annual true-up, or added volume can produce a legitimate statistical outlier.",
          recommendedAction: "Verify whether extra scope or one-time work was authorized for this billing period.",
          amountAtRisk: withTax(excess, taxFactor(inv, inv.taxRate)),
        }));
      }
    }
  }

  // 2. Sudden round-number estimate breaking a historically precise vendor pattern
  const currentLines = inv.lineItems.filter((l) => D(l.total).gt(0));
  const roundLines = currentLines.filter((l) => isRoundHundredOrFifty(D(l.total)));
  if (prior.length >= 3 && currentLines.length > 0 && roundLines.length > 0) {
    const priorProfile = analyzeVendorForensics(prior);
    if (priorProfile.roundNumberRatio <= 0.1) {
      for (const line of roundLines) {
        out.push(makeFinding(inv, {
          ruleId: "unexpected_fee",
          key: `forensic-round-${line.id}`,
          classification: "REVIEW_NEEDED",
          severity: "low",
          title: `Unusual round-number charge (${m(line.total)}) breaks ${inv.vendorName}'s itemized pattern`,
          explanation: `${inv.vendorName}'s earlier invoices almost always use exact calculated amounts, whereas "${line.description}" is billed as an exact round figure (${m(line.total)}), which often indicates an unitemized estimate or lump-sum padding.`,
          expected: "Itemized quantity × unit rate",
          actual: m(line.total),
          difference: "—",
          evidence: [
            `Line "${line.description}": ${m(line.total)} (exact multiple of 50)`,
            `Historical round-number ratio for ${inv.vendorName}: ${Math.round(priorProfile.roundNumberRatio * 100)}%`,
          ],
          confidence: "medium",
          confidenceReason: "Contrasts this round lump sum against the vendor's historically precise line-item distribution.",
          uncertainty: "Fixed retainers, flat-rate packages, or deposit milestones are legitimately round numbers.",
          recommendedAction: "Ask the vendor for the underlying hours, unit breakdown, or calculation supporting this lump-sum charge.",
          amountAtRisk: "0.00",
        }));
      }
    }
  }

  return out;
}
