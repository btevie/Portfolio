import type { AuditFinding, Invoice, InvoiceLineItem } from "../types";
import { D, formatMoney, str2 } from "./money";
import { makeFinding, taxFactor, withTax } from "./rules/util";

export interface SubsetMatch {
  items: InvoiceLineItem[];
  matchedCents: number;
  residualCents: number;
}

const MAX_DP_CENTS = 2_500_000; // cap DP table at 25,000.00 to stay instantaneous in-browser

/**
 * Bounded 0/1 Dynamic Programming Subset-Sum solver in exact integer cents.
 * Finds the subset of line items whose sum is closest to `targetCents` (within `toleranceCents`).
 */
export function solveLineSubsetSum(
  lines: InvoiceLineItem[],
  targetCents: number,
  toleranceCents = 2
): SubsetMatch | null {
  if (targetCents <= 0 || targetCents > MAX_DP_CENTS || lines.length === 0) return null;

  const candidates = lines
    .map((line) => ({ line, cents: Math.round(Number(D(line.total).toFixed(2)) * 100) }))
    .filter((x) => x.cents > 0 && x.cents <= targetCents + toleranceCents)
    .slice(0, 40);

  if (candidates.length === 0) return null;

  const limit = targetCents + toleranceCents;
  const parentItem = new Int32Array(limit + 1).fill(-1);
  const parentPrev = new Int32Array(limit + 1).fill(-1);
  parentItem[0] = 0; // reachable base state

  for (let idx = 0; idx < candidates.length; idx++) {
    const w = candidates[idx].cents;
    for (let s = limit; s >= w; s--) {
      if (parentItem[s - w] !== -1 && parentItem[s] === -1) {
        parentItem[s] = idx;
        parentPrev[s] = s - w;
      }
    }
  }

  let bestSum = -1;
  let bestDiff = Infinity;
  for (let s = Math.max(1, targetCents - toleranceCents); s <= limit; s++) {
    if (parentItem[s] !== -1) {
      const diff = Math.abs(s - targetCents);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestSum = s;
      }
    }
  }

  if (bestSum === -1) return null;

  const chosen: InvoiceLineItem[] = [];
  let cur = bestSum;
  while (cur > 0 && parentItem[cur] !== -1) {
    const idx = parentItem[cur];
    chosen.push(candidates[idx].line);
    cur = parentPrev[cur];
  }

  return {
    items: chosen.reverse(),
    matchedCents: bestSum,
    residualCents: targetCents - bestSum,
  };
}

export function reconcileMathFindings(inv: Invoice): AuditFinding[] {
  const out: AuditFinding[] = [];
  const positiveLines = inv.lineItems.filter((l) => D(l.total).gt(0));
  if (positiveLines.length < 3) return out;

  const m = (v: string) => formatMoney(v, inv.currency);

  // Detect hidden rolled-up sub-bundle duplication:
  // A single large line equals the exact subset sum of 2+ other lines on the same invoice.
  const sorted = [...positiveLines].sort((a, b) => D(b.total).cmp(D(a.total)));
  for (const candidate of sorted.slice(0, 4)) {
    const targetCents = Math.round(Number(D(candidate.total).toFixed(2)) * 100);
    if (targetCents < 1000) continue; // ignore trivial amounts under 10.00
    const others = positiveLines.filter((l) => l.id !== candidate.id);
    const match = solveLineSubsetSum(others, targetCents, 1);
    if (match && match.items.length >= 2) {
      const componentNames = match.items.map((x) => `"${x.description}" (${m(x.total)})`).join(" + ");
      out.push(
        makeFinding(inv, {
          ruleId: "duplicate_line",
          key: `dp-subbundle-${candidate.id}`,
          classification: "REVIEW_NEEDED",
          severity: "high",
          title: `Possible double-counted sub-bundle: "${candidate.description}" equals ${match.items.length} other lines`,
          explanation: `Line "${candidate.description}" (${m(candidate.total)}) equals the exact mathematical sum of ${componentNames}. Vendors sometimes bill both itemized components and a rolled-up summary line on the same invoice.`,
          expected: `Either the summary line or the ${match.items.length} itemized lines`,
          actual: `Both billed (${m(candidate.total)} duplicated)`,
          difference: formatMoney(candidate.total, inv.currency, { signed: true }),
          evidence: [
            `Summary candidate: "${candidate.description}" = ${m(candidate.total)}`,
            `Exact subset sum (${match.items.length} lines): ${componentNames}`,
          ],
          confidence: "high",
          confidenceReason: "Exact integer-cents dynamic programming subset-sum match across multiple distinct line items.",
          uncertainty: "Two independent sets of charges can occasionally sum to the exact same euro/cent amount by coincidence.",
          recommendedAction: "Verify whether the summary line duplicates the itemized lines above/below it and request a credit if double-billed.",
          amountAtRisk: withTax(D(candidate.total), taxFactor(inv, candidate.taxRate)),
        })
      );
      break;
    }
  }

  return out;
}
