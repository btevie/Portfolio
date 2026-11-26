import { compareToHistory, netOf } from "../history";
import { D, formatMoney, str2 } from "../money";
import type { Rule } from "../types";
import { makeFinding } from "./util";

export const priceHistoryRule: Rule = (inv, ctx) => {
  const cmp = compareToHistory(inv, ctx);
  if (!cmp.reliable || cmp.pctDiff === null || cmp.baseline === null) return [];
  const pctDiff = Number(cmp.pctDiff);
  if (pctDiff <= 0) return []; // decreases are shown in the comparison, not flagged
  const variable = ctx.vendor?.billing === "variable";
  const scale = ctx.config.sensitivityScale * (variable ? ctx.config.variableMultiplier : 1);
  const t = ctx.config.thresholds;
  if (pctDiff < t.info * scale) return [];
  if (pctDiff < t.review * scale && variable) return [];

  const severity = pctDiff >= t.high * scale ? "high" : pctDiff >= t.review * scale ? "medium" : "low";
  const m = (v: string) => formatMoney(v, inv.currency);

  // How stable was the history? (stability supports confidence that the change is real)
  const priorNets = ctx.invoices
    .filter((o) => o.id !== inv.id && o.vendorId === inv.vendorId && o.date < inv.date)
    .map(netOf);
  const base = D(cmp.previous ?? cmp.baseline);
  const stable = priorNets.length >= 3 && priorNets.every((n) => n.minus(base).abs().div(base.isZero() ? 1 : base).lt(0.01));
  const confidence = !variable && stable ? "high" : !variable && cmp.sampleSize >= 3 ? "medium" : "low";
  const diff = D(cmp.absDiff!);

  return [makeFinding(inv, {
    ruleId: "price_history", key: "increase",
    classification: "REVIEW_NEEDED", severity,
    title: `Charge is ${cmp.pctDiff}% higher than your usual with ${inv.vendorName}`,
    explanation: `The net charge is ${m(cmp.current)} against a ${cmp.baselineLabel} of ${m(cmp.baseline)} (${formatMoney(diff, inv.currency, { signed: true })}). This is an anomaly, not proof of an error — vendors do raise prices.`,
    expected: m(cmp.baseline), actual: m(cmp.current), difference: formatMoney(diff, inv.currency, { signed: true }),
    evidence: [
      `${cmp.sampleSize} earlier invoices from this vendor`,
      `Previous: ${cmp.previous ?? "—"} · average: ${cmp.average ?? "—"} · 3-month avg: ${cmp.avg3m ?? "—"} · 6-month avg: ${cmp.avg6m ?? "—"}`,
      `Change vs ${cmp.baselineLabel}: ${cmp.pctDiff}%`,
    ],
    confidence,
    confidenceReason: stable
      ? `High confidence the price changed: the previous ${cmp.sampleSize} invoices were effectively identical. Whether this is an error is a separate question.`
      : variable
        ? "Low confidence: this vendor bills by usage, so month-to-month swings are normal and the baseline is noisy."
        : "Medium confidence: the baseline is real but short or slightly uneven.",
    uncertainty: "The vendor may have changed their pricing, added seats or services, or applied an indexation clause. Medium confidence at most that this is an error.",
    recommendedAction: "Check whether you were notified of a price change or changed your plan. If not, ask the vendor to explain the increase.",
    amountAtRisk: str2(diff.times(1 + (inv.taxRate ? D(inv.taxRate).div(100).toNumber() : 0))),
  })];
};
