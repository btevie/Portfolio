import type { AuditFinding } from "../../types";
import { D, formatMoney, str2 } from "../money";
import { isEarlier } from "../history";
import { daysBetween, normalizeDescription, normalizeInvoiceNumber, normalizeVendor, parseISO } from "../normalize";
import type { Rule } from "../types";
import { makeFinding } from "./util";

const NEAR_WINDOW_DAYS = 5;

export const duplicateInvoiceRule: Rule = (inv, ctx) => {
  const out: AuditFinding[] = [];
  const vendor = normalizeVendor(inv.vendorName);
  const number = normalizeInvoiceNumber(inv.number);
  const m = (v: string) => formatMoney(v, inv.currency);
  const earlier = ctx.invoices.filter(
    (o) => o.id !== inv.id && normalizeVendor(o.vendorName) === vendor && o.currency === inv.currency && isEarlier(o, inv),
  );

  const exact = earlier.find((o) => normalizeInvoiceNumber(o.number) === number && D(o.total).eq(D(inv.total)));
  if (exact) {
    out.push(makeFinding(inv, {
      ruleId: "duplicate_invoice", key: `exact-${exact.id}`,
      classification: "LIKELY_ERROR", severity: "high",
      title: "Exact duplicate of an invoice you already have",
      explanation: `Invoice ${inv.number} from ${inv.vendorName} has the same invoice number and the same total (${m(inv.total)}) as ${exact.number} dated ${exact.date}. Paying both would pay the same bill twice.`,
      expected: "One invoice for this charge", actual: "Two invoices with the same number and total", difference: m(inv.total),
      evidence: [`Original: ${exact.number}, ${exact.date}, ${exact.total}`, `This copy: ${inv.number}, ${inv.date}, ${inv.total}`, "Vendor, invoice number and total all match after normalisation"],
      confidence: "high",
      confidenceReason: "Vendor, invoice number and total all match exactly — it is very unlikely to be two separate charges.",
      uncertainty: "It may be a harmless re-send of the same bill. It only costs money if both copies get paid.",
      recommendedAction: "Pay only one copy. If you've already paid both, ask the vendor for a refund or credit of the second payment.",
      amountAtRisk: str2(D(inv.total)),
    }));
    return out; // no need to also raise near-duplicates for the same pair
  }

  const sameNumber = earlier.find((o) => normalizeInvoiceNumber(o.number) === number);
  if (sameNumber) {
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
  for (const [key, lines] of groups) {
    if (lines.length < 2) continue;
    const extra = lines.slice(1).reduce((a, l) => a.plus(D(l.total)), D(0));
    out.push(makeFinding(inv, {
      ruleId: "duplicate_line", key: encodeURIComponent(key).slice(0, 60),
      classification: "REVIEW_NEEDED", severity: "medium",
      title: `"${lines[0].description}" is billed ${lines.length} times, identically`,
      explanation: `${lines.length} lines share the same description, quantity (${lines[0].quantity}) and unit price (${lines[0].unitPrice}). Repeated items with different quantities or prices aren't flagged — these are identical.`,
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
