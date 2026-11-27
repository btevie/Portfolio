import type { Invoice } from "../types";
import { D, round2, str2 } from "./money";
import { normalizeDescription } from "./normalize";
import { priorInvoices } from "./history";
import type { AuditContext } from "./types";

export interface LineCompareRow {
  description: string;
  kind: "item" | "fee";
  status: "changed" | "same" | "new" | "gone";
  prevUnit?: string; unit?: string;
  prevQty?: string; qty?: string;
  /** Unit-price change (decimal string, invoice currency); only when the same line exists on both invoices. */
  unitDiff?: string;
  /** Percent change of the unit price, 1 decimal. Null when the earlier price was zero. */
  unitPct?: string | null;
}

export interface LineComparison { previous: Invoice; rows: LineCompareRow[] }

/**
 * Compares lines with the most recent earlier invoice from the same vendor and currency. Lines are matched only by
 * identical normalised description (and kind); anything else is shown as new / no longer billed, never paired by guess.
 */
export function compareLines(inv: Invoice, ctx: AuditContext): LineComparison | null {
  const prior = priorInvoices(inv, ctx);
  const previous = prior[prior.length - 1];
  if (!previous) return null;
  const key = (l: Invoice["lineItems"][number]) => `${l.kind}|${normalizeDescription(l.description)}`;
  const before = new Map(previous.lineItems.map((l) => [key(l), l]));
  const used = new Set<string>();
  const rows: LineCompareRow[] = inv.lineItems.map((l) => {
    const k = key(l), p = before.get(k);
    if (!p || used.has(k)) return { description: l.description, kind: l.kind, status: "new", unit: l.unitPrice, qty: l.quantity };
    used.add(k);
    const diff = D(l.unitPrice).minus(D(p.unitPrice));
    const same = diff.isZero() && D(l.quantity).eq(D(p.quantity));
    return {
      description: l.description, kind: l.kind, status: same ? "same" : "changed",
      prevUnit: p.unitPrice, unit: l.unitPrice, prevQty: p.quantity, qty: l.quantity,
      unitDiff: str2(round2(diff)),
      unitPct: D(p.unitPrice).isZero() ? null : diff.div(D(p.unitPrice)).times(100).toDecimalPlaces(1).toFixed(1),
    };
  });
  for (const p of previous.lineItems) if (!used.has(key(p))) rows.push({ description: p.description, kind: p.kind, status: "gone", prevUnit: p.unitPrice, prevQty: p.quantity });
  return { previous, rows };
}
