import type { AuditFinding, Invoice } from "../../types";
import { scaled } from "../currency-scale";

function lineTokenSet(inv: Invoice): Set<string> {
  const words = inv.lineItems
    .flatMap((l) => normalizeDescription(l.description).split(/\s+/))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
import { D, formatMoney, str2 } from "../money";
import { DUPLICATE_COPY_WINDOW_DAYS, isDuplicateCopy, isEarlier } from "../history";
import { daysBetween, normalizeDescription, normalizeInvoiceNumber, normalizeVendor, parseISO } from "../normalize";
import type { Rule } from "../types";
import { makeFinding } from "./util";

const NEAR_WINDOW_DAYS = DUPLICATE_COPY_WINDOW_DAYS;

export const duplicateInvoiceRule: Rule = (inv, ctx) => {
  const out: AuditFinding[] = [];
  const vendor = normalizeVendor(inv.vendorName);
  const number = normalizeInvoiceNumber(inv.number);
  const m = (v: string) => formatMoney(v, inv.currency);
  const earlier = ctx.invoices.filter(
    (o) => o.id !== inv.id && normalizeVendor(o.vendorName) === vendor && o.currency === inv.currency && isEarlier(o, inv),
  ).sort((a, b) => (parseISO(a.date) ?? 0) - (parseISO(b.date) ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  // Missing numbers carry no identity; never treat two blank-number bills as exact duplicates.
  const exact = number ? earlier.find((o) => isDuplicateCopy(o, inv)) : undefined;
  if (exact) {
    out.push(makeFinding(inv, {
      ruleId: "duplicate_invoice", key: `exact-${exact.id}`,
      classification: "LIKELY_ERROR", severity: "high",
      title: "Exact duplicate of an invoice you already have",
      explanation: `Invoice ${inv.number} from ${inv.vendorName} has the same invoice number and the same total (${m(inv.total)}) as ${exact.number} dated ${exact.date}. Paying both would pay the same bill twice.`,
      expected: "One invoice for this charge", actual: "Two invoices with the same number and total", difference: m(inv.total),
      evidence: [`Original: ${exact.number}, ${exact.date}, ${exact.total}`, `This copy: ${inv.number}, ${inv.date}, ${inv.total}`, "Vendor, invoice number and total all match after normalisation"],
      confidence: "high",
      confidenceReason: "Vendor, invoice number and total all match exactly, so it is very unlikely to be two separate charges.",
      uncertainty: "It may be a harmless re-send of the same bill. It only costs money if both copies get paid.",
      recommendedAction: "Pay only one copy. If you've already paid both, ask the vendor for a refund or credit of the second payment.",
      amountAtRisk: str2(D(inv.total)),
    }));
    return out; // no need to also raise near-duplicates for the same pair
  }

  const sameNumber = number ? earlier.find((o) => normalizeInvoiceNumber(o.number) === number) : undefined;
  if (sameNumber) {
    if (D(sameNumber.total).eq(D(inv.total))) {
      out.push(makeFinding(inv, {
        ruleId: "duplicate_invoice", key: `reused-${sameNumber.id}`,
        classification: "REVIEW_NEEDED", severity: "low",
        title: "Invoice number and total match, but the invoice date is different",
        explanation: `${inv.vendorName} used invoice number ${inv.number} for ${m(inv.total)} on ${sameNumber.date} and ${inv.date}. Vendors sometimes reuse number sequences, so this may be a separate billing period rather than a duplicate.`,
        expected: "A unique invoice number or confirmation that this is a resend", actual: `${inv.number} on two different dates`, difference: "—",
        evidence: [`Earlier: ${sameNumber.number}, ${sameNumber.date}, ${sameNumber.total}`, `This invoice: ${inv.number}, ${inv.date}, ${inv.total}`],
        confidence: "low", confidenceReason: "The number and total match, but the dates are far enough apart that this may be a reused invoice number.",
        uncertainty: "It could still be a duplicate with an altered invoice date.",
        recommendedAction: "Check the service period and ask the vendor whether this replaces the earlier invoice.",
      }));
      return out;
    }
    out.push(makeFinding(inv, {
      ruleId: "duplicate_invoice", key: `renumbered-${sameNumber.id}`,
      classification: "REVIEW_NEEDED", severity: "medium",
      title: "Same invoice number as an earlier invoice, different total",
      explanation: `Invoice number ${inv.number} was already used by ${inv.vendorName} on ${sameNumber.date} for ${m(sameNumber.total)}. This one is ${m(inv.total)}.`,
      expected: m(sameNumber.total), actual: m(inv.total), difference: formatMoney(D(inv.total).minus(D(sameNumber.total)), inv.currency),
      evidence: [`Earlier: ${sameNumber.number}, ${sameNumber.date}, ${sameNumber.total}`, `This: ${inv.number}, ${inv.date}, ${inv.total}`],
      confidence: "medium",
      confidenceReason: "The invoice number matches, which is unusual, but the totals differ so it may be a corrected version.",
      uncertainty: "This may be an amended invoice that replaces the earlier one.",
      recommendedAction: "Ask the vendor whether this replaces the earlier invoice, and pay only the correct one.",
    }));
    return out;
  }

  const t = parseISO(inv.date);
  const near = earlier.find((o) => {
    const ot = parseISO(o.date);
    return t !== null && ot !== null && D(o.total).eq(D(inv.total)) && Math.abs(daysBetween(ot, t)) <= NEAR_WINDOW_DAYS;
  });
  if (near) {
    out.push(makeFinding(inv, {
      ruleId: "duplicate_invoice", key: `near-${near.id}`,
      classification: "REVIEW_NEEDED", severity: "medium",
      title: "Possible duplicate: same vendor, same total, nearly the same date",
      explanation: `${inv.vendorName} issued ${near.number} for ${m(near.total)} on ${near.date}, and this invoice (${inv.number}) is the same amount only ${Math.abs(daysBetween(parseISO(near.date)!, t!))} day(s) apart, under a different number.`,
      expected: "A distinct charge", actual: "Same amount within days", difference: m(inv.total),
      evidence: [`Other: ${near.number}, ${near.date}, ${near.total}`, `This: ${inv.number}, ${inv.date}, ${inv.total}`],
      confidence: "low",
      confidenceReason: "Matching amounts close together are suggestive but not conclusive; different invoice numbers suggest they could be separate bills.",
      uncertainty: "Vendors do bill identical amounts for genuinely separate work or periods.",
      recommendedAction: "Check what each invoice covers (service period, PO number) before paying both.",
      amountAtRisk: str2(D(inv.total)),
    }));
    return out;
  }

  if (t !== null && D(inv.total).gt(0)) {
    const myTokens = lineTokenSet(inv);
    for (const o of earlier) {
      const ot = parseISO(o.date);
      if (ot === null) continue;
      const gap = Math.abs(daysBetween(ot, t));
      if (gap > 14) continue;

      const sim = jaccardSimilarity(myTokens, lineTokenSet(o));
      const ratio = D(o.total).gt(0) ? D(inv.total).minus(D(o.total)).abs().div(D(o.total)) : D(1);

      if (sim >= 0.65 && ratio.lte("0.15")) {
        out.push(makeFinding(inv, {
          ruleId: "duplicate_invoice",
          key: `fuzzy-${o.id}`,
          classification: "REVIEW_NEEDED",
          severity: "medium",
          title: `Fuzzy near-duplicate (${Math.round(sim * 100)}% line overlap with ${o.number})`,
          explanation: `${inv.vendorName} billed ${m(o.total)} on ${o.date} (${o.number}) and ${m(inv.total)} on ${inv.date} (${inv.number}) with ${Math.round(sim * 100)}% overlapping line-item descriptions.`,
          expected: "Distinct line items or separate billing period",
          actual: `${Math.round(sim * 100)}% description overlap within ${gap} day(s)`,
          difference: m(inv.total),
          evidence: [`Earlier: ${o.number} (${o.date}) · ${m(o.total)}`, `Current: ${inv.number} (${inv.date}) · ${m(inv.total)}`, `Keyword similarity: ${Math.round(sim * 100)}%`],
          confidence: "medium",
          confidenceReason: "High line-item keyword overlap within a short window often indicates re-billed or slightly adjusted duplicate work.",
          uncertainty: "Separate deliveries or milestones with similar descriptions can legitimately occur close together.",
          recommendedAction: "Compare the underlying deliverables or PO references for both invoices before paying.",
          amountAtRisk: str2(D(inv.total)),
        }));
        break;
      }

      if (gap <= 2 && D(o.total).gt(0)) {
        const combined = D(inv.total).plus(D(o.total));
        const L500 = scaled(500, inv.currency), L1000 = scaled(1000, inv.currency); // approval-limit style thresholds, sized for the invoice currency
        const crossed500 = D(inv.total).lt(L500) && D(o.total).lt(L500) && combined.gte(L500);
        const crossed1000 = D(inv.total).lt(L1000) && D(o.total).lt(L1000) && combined.gte(L1000);
        if (crossed500 || crossed1000) {
          const threshold = crossed1000 ? 1000 : 500;
          out.push(makeFinding(inv, {
            ruleId: "duplicate_invoice",
            key: `split-${o.id}`,
            classification: "REVIEW_NEEDED",
            severity: "low",
            title: `Possible split billing: two bills within ${gap} day(s) totaling ${m(str2(combined))}`,
            explanation: `${inv.vendorName} issued two separate invoices within ${gap} day(s)—${o.number} (${m(o.total)}) and ${inv.number} (${m(inv.total)})—each below ${m(String(threshold))} but combining to ${m(str2(combined))}.`,
            expected: "Consolidated invoice or distinct purchase orders",
            actual: `Split across ${o.number} and ${inv.number}`,
            difference: m(str2(combined)),
            evidence: [`Invoice 1: ${o.number} (${o.date}) · ${m(o.total)}`, `Invoice 2: ${inv.number} (${inv.date}) · ${m(inv.total)}`, `Combined 48h total: ${m(str2(combined))}`],
            confidence: "medium",
            confidenceReason: "Multiple invoices just under common approval thresholds within 48 hours warrant a combined review.",
            uncertainty: "Two separate orders or departments can legitimately generate two invoices within 48 hours.",
            recommendedAction: "Verify that both invoices represent separate approved work rather than a single charge split into two.",
            amountAtRisk: "0.00",
          }));
          break;
        }
      }
    }
  }
  return out;
};

export const duplicateLineRule: Rule = (inv) => {
  const groups = new Map<string, typeof inv.lineItems>();
  for (const l of inv.lineItems) {
    if (D(l.total).isZero()) continue;
    const key = `${l.kind}|${normalizeDescription(l.description)}|${D(l.quantity).toString()}|${D(l.unitPrice).toString()}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const out: AuditFinding[] = [];
  for (const lines of groups.values()) {
    if (lines.length < 2) continue;
    const extra = lines.slice(1).reduce((a, l) => a.plus(D(l.total)), D(0));
    out.push(makeFinding(inv, {
      ruleId: "duplicate_line", key: `line-${lines[0].id}`,
      classification: "REVIEW_NEEDED", severity: "medium",
      title: `"${lines[0].description}" is billed ${lines.length} times, identically`,
      explanation: `${lines.length} lines share the same description, quantity (${lines[0].quantity}) and unit price (${lines[0].unitPrice}). Repeated items with different quantities or prices aren't flagged, but these are identical.`,
      expected: "One line (or distinct quantities/prices)", actual: `${lines.length} identical lines`, difference: formatMoney(extra, inv.currency),
      evidence: lines.map((l) => `${l.description}: ${l.quantity} × ${l.unitPrice} = ${l.total}`),
      confidence: "medium",
      confidenceReason: "Identical description, quantity and price is a common double-entry pattern, but invoices can legitimately repeat a line.",
      uncertainty: "The repeated line may cover separate periods or locations that the description doesn't distinguish.",
      recommendedAction: "Ask the vendor what each repeated line covers.",
      amountAtRisk: str2(extra),
    }));
  }
  return out;
};
