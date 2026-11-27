import type { AuditFinding, Invoice } from "../types";
import { netOf, priorInvoices } from "./history";
import { D, formatMoney, str2 } from "./money";
import { daysBetween, parseISO } from "./normalize";
import type { AuditContext } from "./types";
import { makeFinding, taxFactor, withTax } from "./rules/util";

// Annual Dutch CBS CPI & Eurozone HICP reference rates (%)
export const BENCHMARK_INFLATION_PCT: Record<number, { nlCbs: number; euHicp: number }> = {
  2021: { nlCbs: 2.7, euHicp: 2.6 },
  2022: { nlCbs: 10.0, euHicp: 8.4 },
  2023: { nlCbs: 3.8, euHicp: 5.4 },
  2024: { nlCbs: 3.3, euHicp: 2.4 },
  2025: { nlCbs: 3.1, euHicp: 2.2 },
  2026: { nlCbs: 2.6, euHicp: 2.0 },
};

const INDEXATION_WORDS = /\b(indexatie|prijsindexatie|cpi|inflatie|inflatiecorrectie|indexation|inflation adjustment|annual price adjustment)\b/i;

export function benchmarkRateForYear(year: number, currency: string): { rate: number; label: string } {
  const entry = BENCHMARK_INFLATION_PCT[year] ?? BENCHMARK_INFLATION_PCT[2026];
  if (currency === "EUR") {
    return { rate: entry.nlCbs, label: `Dutch CBS CPI (${year}: ${entry.nlCbs}%)` };
  }
  return { rate: entry.euHicp, label: `EU HICP benchmark (${year}: ${entry.euHicp}%)` };
}

export function inflationIndexFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  const out: AuditFinding[] = [];
  const invMs = parseISO(inv.date);
  if (invMs === null) return out;

  const year = Number(inv.date.slice(0, 4));
  const bench = benchmarkRateForYear(year, inv.currency);
  const m = (v: string) => formatMoney(v, inv.currency);

  const prior = priorInvoices(inv, ctx);
  if (prior.length === 0) return out;

  // Find a comparable invoice from ~11 to 14 months earlier (year-over-year renewal)
  const yoyPeer = [...prior]
    .reverse()
    .find((p) => {
      const pMs = parseISO(p.date);
      if (pMs === null) return false;
      const gap = daysBetween(pMs, invMs);
      return gap >= 320 && gap <= 420;
    });

  const baselineInv = yoyPeer ?? prior[prior.length - 1];
  const prevNet = netOf(baselineInv);
  const currNet = netOf(inv);
  if (prevNet.lte(0) || currNet.lte(prevNet)) return out;

  const actualPct = currNet.minus(prevNet).div(prevNet).times(100);
  const excessPts = actualPct.minus(D(bench.rate));
  const mentionsIndexation = inv.lineItems.some((l) => INDEXATION_WORDS.test(l.description));

  // Trigger when vendor blames CPI/indexation OR year-over-year increase exceeds benchmark inflation by > 2.0 percentage points
  const shouldFlag =
    (mentionsIndexation && excessPts.gt("1.0")) ||
    (yoyPeer !== undefined && excessPts.gt("2.0") && ctx.vendor?.billing !== "variable");

  if (!shouldFlag) return out;

  const fairInflationTotal = prevNet.times(D(bench.rate).div(100).plus(1));
  const excessAmount = currNet.minus(fairInflationTotal);
  if (excessAmount.lte(0)) return out;

  out.push(makeFinding(inv, {
    ruleId: "price_history",
    key: `cpi-excess-${year}`,
    classification: "REVIEW_NEEDED",
    severity: excessPts.gte("5.0") ? "high" : "medium",
    title: `Price hike (+${actualPct.toFixed(1)}%) exceeds ${bench.label} by +${excessPts.toFixed(1)} pts`,
    explanation: `${inv.vendorName} increased net charges from ${m(str2(prevNet))} (${baselineInv.date}) to ${m(str2(currNet))} (+${actualPct.toFixed(1)}%), outpacing ${bench.label} by ${excessPts.toFixed(1)} percentage points (${m(str2(excessAmount))} above pure inflation).`,
    expected: `${m(str2(fairInflationTotal))} (+${bench.rate}% inflation)`,
    actual: `${m(str2(currNet))} (+${actualPct.toFixed(1)}%)`,
    difference: formatMoney(str2(excessAmount), inv.currency, { signed: true }),
    evidence: [
      `Baseline invoice ${baselineInv.number} (${baselineInv.date}): ${m(str2(prevNet))}`,
      `Current invoice ${inv.number} (${inv.date}): ${m(str2(currNet))} (+${actualPct.toFixed(1)}%)`,
      `Reference inflation: ${bench.label} → real excess +${excessPts.toFixed(1)} percentage points`,
    ],
    confidence: "high",
    confidenceReason: "Compares exact year-over-year invoice net totals against official Dutch CBS CPI / EU HICP inflation rates.",
    uncertainty: "A vendor's contract may permit CPI + a fixed surcharge (e.g., CPI + 2%), or the bill may include upgraded scope/seats.",
    recommendedAction: `Ask ${inv.vendorName} to justify the +${excessPts.toFixed(1)}% real increase above ${bench.label}, or request an adjustment aligned with actual CPI.`,
    amountAtRisk: withTax(excessAmount, taxFactor(inv, inv.taxRate)),
  }));

  return out;
}
