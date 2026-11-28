import type { AuditFinding, Invoice } from "../types";
import { scaled } from "./currency-scale";
import { netOf, priorInvoices } from "./history";
import { D, formatMoney, str2 } from "./money";
import { parseISO } from "./normalize";
import type { AuditContext } from "./types";
import { makeFinding, taxFactor, withTax } from "./rules/util";

export interface VendorSpendForecast {
  sampleSize: number;
  slopePerBill: string;
  projectedNext: string;
  ci95Low: string;
  ci95High: string;
  projectedAnnualBurn: string;
  annualizedDriftPct: number;
}

export function forecastVendorSpend(invoices: Invoice[]): VendorSpendForecast | null {
  const valid = invoices
    .filter((i) => !i.isCredit && i.extraction !== "mock" && parseISO(i.date) !== null)
    .sort((a, b) => (parseISO(a.date)! - parseISO(b.date)!) || a.createdAt - b.createdAt);

  if (valid.length < 4) return null;

  const ys = valid.map((i) => Number(netOf(i).toFixed(2)));
  const n = ys.length;
  const xs = Array.from({ length: n }, (_, idx) => idx);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  if (meanY <= 0) return null;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const intercept = meanY - slope * meanX;

  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const sse = residuals.reduce((acc, r) => acc + r * r, 0);
  const stdErr = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;

  const nextX = n;
  const projectedNextNum = Math.max(0, intercept + slope * nextX);
  const margin95 = 1.96 * stdErr;
  const ci95LowNum = Math.max(0, projectedNextNum - margin95);
  const ci95HighNum = projectedNextNum + margin95;

  // Project next 12 bills sum
  let annualSum = 0;
  for (let k = 0; k < 12; k++) {
    annualSum += Math.max(0, intercept + slope * (n + k));
  }

  const annualizedDriftPct = Number((((slope * 12) / meanY) * 100).toFixed(1));

  return {
    sampleSize: n,
    slopePerBill: str2(D(slope.toFixed(4))),
    projectedNext: str2(D(projectedNextNum.toFixed(2))),
    ci95Low: str2(D(ci95LowNum.toFixed(2))),
    ci95High: str2(D(ci95HighNum.toFixed(2))),
    projectedAnnualBurn: str2(D(annualSum.toFixed(2))),
    annualizedDriftPct,
  };
}

export function forecastAnomalyFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  const prior = priorInvoices(inv, ctx);
  if (prior.length < 4 || ctx.vendor?.billing === "variable") return [];

  const fc = forecastVendorSpend(prior);
  if (!fc) return [];

  const currNet = netOf(inv);
  const upper95 = D(fc.ci95High);
  const projected = D(fc.projectedNext);
  const m = (v: string) => formatMoney(v, inv.currency);

  if (currNet.gt(upper95) && currNet.minus(projected).gte(scaled(10, inv.currency))) {
    const excess = currNet.minus(projected);
    return [
      makeFinding(inv, {
        ruleId: "price_history",
        key: "ols-ci95-breach",
        classification: "REVIEW_NEEDED",
        severity: currNet.minus(upper95).gte(scaled(50, inv.currency)) ? "medium" : "low",
        title: `Above 95% econometric forecast envelope (${m(str2(currNet))} vs ${m(fc.projectedNext)} expected)`,
        explanation: `Based on a least-squares regression across ${fc.sampleSize} prior bills, ${inv.vendorName}'s expected charge was ${m(fc.projectedNext)} (95% range: ${m(fc.ci95Low)}–${m(fc.ci95High)}). This invoice breaks above the upper confidence bound.`,
        expected: `${m(fc.projectedNext)} (95% CI: ${m(fc.ci95Low)}–${m(fc.ci95High)})`,
        actual: m(str2(currNet)),
        difference: formatMoney(str2(excess), inv.currency, { signed: true }),
        evidence: [
          `OLS trend slope: ${formatMoney(fc.slopePerBill, inv.currency, { signed: true })} per bill (${fc.annualizedDriftPct > 0 ? "+" : ""}${fc.annualizedDriftPct}%/yr drift)`,
          `95% prediction interval: ${m(fc.ci95Low)} to ${m(fc.ci95High)}`,
        ],
        confidence: "high",
        confidenceReason: "Calculated using ordinary least-squares trend regression and residual standard error across historical invoices.",
        uncertainty: "A planned tier upgrade, seasonal spike, or one-off add-on can exceed the historical trend envelope.",
        recommendedAction: "Verify whether new seats, usage overages, or an unannounced price increase caused the break above trend.",
        amountAtRisk: withTax(excess, taxFactor(inv, inv.taxRate)),
      }),
    ];
  }

  return [];
}
