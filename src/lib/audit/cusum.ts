import type { AuditFinding, Invoice } from "../types";
import { netOf, priorInvoices } from "./history";
import { D, formatMoney, str2 } from "./money";
import { parseISO } from "./normalize";
import type { AuditContext } from "./types";
import { makeFinding, taxFactor, withTax } from "./rules/util";

export function cusumChangePointFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  if (ctx.vendor?.billing === "variable") return [];

  const prior = priorInvoices(inv, ctx)
    .filter((p) => parseISO(p.date) !== null)
    .sort((a, b) => (parseISO(a.date)! - parseISO(b.date)!) || a.createdAt - b.createdAt);

  if (prior.length < 4) return [];

  // Use the initial 3 invoices as the reference process baseline (mu_0, sigma_0)
  const refSlice = prior.slice(0, Math.min(3, prior.length));
  const refVals = refSlice.map((p) => Number(netOf(p).toFixed(2)));
  const mu0 = refVals.reduce((a, b) => a + b, 0) / refVals.length;
  if (mu0 <= 0) return [];

  const refVar =
    refVals.length > 1
      ? refVals.reduce((acc, v) => acc + (v - mu0) ** 2, 0) / (refVals.length - 1)
      : 0;
  // Minimum floor on sigma0 (1.5% of baseline) so ultra-flat subscriptions still have realistic slack
  const sigma0 = Math.max(Math.sqrt(refVar), mu0 * 0.015);
  const slackK = 0.5 * sigma0;
  const thresholdH = 4.0 * sigma0;

  const series = [...prior, inv];
  let cusumPos = 0;
  let changeStartDate: string | null = null;
  let prevCusum = 0;

  for (let i = refSlice.length; i < series.length; i++) {
    prevCusum = cusumPos;
    const x = Number(netOf(series[i]).toFixed(2));
    const step = x - mu0 - slackK;
    if (cusumPos === 0 && step > 0) {
      changeStartDate = series[i].date;
    }
    cusumPos = Math.max(0, cusumPos + step);
    if (cusumPos === 0) changeStartDate = null;
  }

  // Only fire when the current invoice pushes cumulative drift across H (or deepens an active breach)
  const currNet = Number(netOf(inv).toFixed(2));
  const totalDrift = currNet - mu0;
  if (cusumPos <= thresholdH || totalDrift <= 5) return [];

  const driftStr = str2(D(totalDrift.toFixed(2)));
  const mu0Str = str2(D(mu0.toFixed(2)));
  const m = (v: string) => formatMoney(v, inv.currency);

  return [
    makeFinding(inv, {
      ruleId: "price_history",
      key: "cusum-regime-shift",
      classification: "REVIEW_NEEDED",
      severity: cusumPos >= thresholdH * 2 ? "high" : "medium",
      title: `CUSUM structural price drift (+${m(driftStr)} above initial baseline)`,
      explanation: `Page's cumulative-sum (CUSUM) control chart detected a sustained upward shift from ${inv.vendorName}'s initial baseline of ${m(mu0Str)}${changeStartDate ? ` starting around ${changeStartDate}` : ""}. Even though individual step increases were small, cumulative upward drift reached ${m(str2(D(cusumPos.toFixed(2))))} (control limit: ${m(str2(D(thresholdH.toFixed(2))))}).`,
      expected: `${m(mu0Str)} (initial baseline regime)`,
      actual: m(str2(D(currNet.toFixed(2)))),
      difference: formatMoney(driftStr, inv.currency, { signed: true }),
      evidence: [
        `Initial baseline mean (μ₀ across ${refSlice.length} bills): ${m(mu0Str)}`,
        `Cumulative upward statistic (S⁺): ${m(str2(D(cusumPos.toFixed(2))))} > limit ${m(str2(D(thresholdH.toFixed(2))))}`,
        ...(changeStartDate && prevCusum <= thresholdH ? [`Regime shift onset: ${changeStartDate}`] : []),
      ],
      confidence: "high",
      confidenceReason: "Computed via Page's tabular CUSUM statistical process control chart across chronological invoices.",
      uncertainty: "Gradual volume growth, seat additions, or agreed indexation steps can produce a sustained upward CUSUM signal.",
      recommendedAction: "Review whether incremental increases since your initial bills were authorized, or ask the vendor to restore your original rate.",
      amountAtRisk: withTax(D(driftStr), taxFactor(inv, inv.taxRate)),
    }),
  ];
}
