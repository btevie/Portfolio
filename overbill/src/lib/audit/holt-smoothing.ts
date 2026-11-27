import type { AuditFinding, Invoice } from "../types";
import { netOf, priorInvoices } from "./history";
import { D, formatMoney, str2 } from "./money";
import { parseISO } from "./normalize";
import type { AuditContext } from "./types";
import { makeFinding, taxFactor, withTax } from "./rules/util";

// Seasonal multipliers by calendar month (1..12) for variable/utility/cloud spend
const MONTH_SEASONAL_INDEX: Record<number, number> = {
  1: 1.18, 2: 1.15, 3: 1.05, 4: 0.96, 5: 0.90, 6: 0.86,
  7: 0.85, 8: 0.87, 9: 0.94, 10: 1.02, 11: 1.10, 12: 1.12,
};

function monthOf(isoDate: string): number {
  const m = Number(isoDate.slice(5, 7));
  return m >= 1 && m <= 12 ? m : 6;
}

export function holtSeasonalFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  // Specifically adds seasonal intelligence for variable/usage-based vendors where naive thresholds are noisy
  if (ctx.vendor?.billing !== "variable") return [];

  const prior = priorInvoices(inv, ctx)
    .filter((p) => parseISO(p.date) !== null)
    .sort((a, b) => (parseISO(a.date)! - parseISO(b.date)!) || a.createdAt - b.createdAt);

  if (prior.length < 4) return [];

  // Deseasonalize historical net totals
  const deseasonalized = prior.map((p) => {
    const raw = Number(netOf(p).toFixed(2));
    const idx = MONTH_SEASONAL_INDEX[monthOf(p.date)] ?? 1;
    return raw / idx;
  });

  // Holt's Double Exponential Smoothing (level L_t, trend T_t)
  const alpha = 0.45;
  const beta = 0.25;
  let level = deseasonalized[0];
  let trend = deseasonalized[1] - deseasonalized[0];
  const errors: number[] = [];

  for (let t = 1; t < deseasonalized.length; t++) {
    const forecast = level + trend;
    const actual = deseasonalized[t];
    errors.push(Math.abs(actual - forecast));
    const prevLevel = level;
    level = alpha * actual + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  const nextDeseasonalized = Math.max(0, level + trend);
  const currentSeasonIdx = MONTH_SEASONAL_INDEX[monthOf(inv.date)] ?? 1;
  const expectedSeasonal = nextDeseasonalized * currentSeasonIdx;

  // Robust scale via Median Absolute Deviation (MAD)
  const sortedErr = [...errors].sort((a, b) => a - b);
  const mad = sortedErr[Math.floor(sortedErr.length / 2)] || 1;
  const robustSigma = mad * 1.4826 * currentSeasonIdx;

  const currNetNum = Number(netOf(inv).toFixed(2));
  const excessNum = currNetNum - expectedSeasonal;
  if (excessNum <= 25 || excessNum <= 2.5 * robustSigma) return [];

  const expectedStr = str2(D(expectedSeasonal.toFixed(2)));
  const excessStr = str2(D(excessNum.toFixed(2)));
  const m = (v: string) => formatMoney(v, inv.currency);

  return [
    makeFinding(inv, {
      ruleId: "price_history",
      key: "holt-seasonal-spike",
      classification: "REVIEW_NEEDED",
      severity: excessNum >= 100 ? "medium" : "low",
      title: `Seasonally adjusted spike (+${m(excessStr)} above Holt forecast)`,
      explanation: `Even after adjusting for seasonal month patterns (index ${currentSeasonIdx.toFixed(2)}×) and trend via Holt's double exponential smoothing across ${prior.length} bills, this charge (${m(str2(netOf(inv)))}) exceeds the seasonally expected ${m(expectedStr)}.`,
      expected: `${m(expectedStr)} (season-adjusted)`,
      actual: m(str2(netOf(inv))),
      difference: formatMoney(excessStr, inv.currency, { signed: true }),
      evidence: [
        `Seasonally adjusted Holt forecast: ${m(expectedStr)} (month factor ${currentSeasonIdx.toFixed(2)}×)`,
        `Robust seasonal scale (1.48×MAD): ±${m(str2(D(robustSigma.toFixed(2))))}`,
      ],
      confidence: "high",
      confidenceReason: "Combines seasonal month normalization, Holt's double exponential smoothing, and robust MAD dispersion.",
      uncertainty: "Extreme weather, unusual usage bursts, or tariff tier changes can exceed normal seasonal patterns.",
      recommendedAction: "Check meter readings, usage logs, or underlying unit tariff rates for any unannounced rate increase.",
      amountAtRisk: withTax(D(excessStr), taxFactor(inv, inv.taxRate)),
    }),
  ];
}
