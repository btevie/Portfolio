import type { AuditFinding, Invoice } from "../types";
import { priorInvoices } from "./history";
import { D, Decimal, formatMoney, str2 } from "./money";
import { daysBetween, parseISO } from "./normalize";
import type { AuditContext } from "./types";
import { makeFinding } from "./rules/util";

const BIK_WORDS = /\b(incassokosten|buitengerechtelijke\s+kosten|aanmaningskosten|herinneringskosten|administratiekosten\s+incasso|collection\s+fee|dunning\s+fee)\b/i;

/**
 * Exact Dutch statutory sliding scale (staffel) under the Besluit vergoeding voor
 * buitengerechtelijke incassokosten (BIK), including the €40 minimum and €6,775 cap.
 */
export function statutoryBikMaxEur(principal: Decimal): Decimal {
  if (principal.lte(0)) return D(0);
  let fee = D(0);

  const b1 = Decimal.min(principal, D(2500));
  fee = fee.plus(b1.times("0.15"));

  if (principal.gt(2500)) {
    const b2 = Decimal.min(principal.minus(2500), D(2500));
    fee = fee.plus(b2.times("0.10"));
  }
  if (principal.gt(5000)) {
    const b3 = Decimal.min(principal.minus(5000), D(5000));
    fee = fee.plus(b3.times("0.05"));
  }
  if (principal.gt(10000)) {
    const b4 = Decimal.min(principal.minus(10000), D(190000));
    fee = fee.plus(b4.times("0.01"));
  }
  if (principal.gt(200000)) {
    const b5 = principal.minus(200000);
    fee = fee.plus(b5.times("0.005"));
  }

  const floored = Decimal.max(fee, D(40));
  return Decimal.min(floored, D(6775));
}

export function wkiStaircaseFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  if (inv.currency !== "EUR") return [];
  const feeLines = inv.lineItems.filter((l) => BIK_WORDS.test(l.description) && D(l.total).gt(0));
  if (feeLines.length === 0) return [];

  const out: AuditFinding[] = [];
  const m = (v: string) => formatMoney(v, "EUR");

  const chargedFee = feeLines.reduce((acc, l) => acc.plus(D(l.total)), D(0));
  const principal = Decimal.max(D(0), D(inv.subtotal).minus(chargedFee));
  const maxAllowed = statutoryBikMaxEur(principal);

  // 1. Check whether charged collection costs exceed the exact Dutch statutory BIK staffel
  if (chargedFee.gt(maxAllowed.plus("0.05"))) {
    const excess = chargedFee.minus(maxAllowed);
    out.push(
      makeFinding(inv, {
        ruleId: "unexpected_fee",
        key: "nl-bik-staffel-cap",
        classification: "LIKELY_ERROR",
        severity: "high",
        title: `Collection fee (${m(str2(chargedFee))}) exceeds Dutch statutory BIK cap (${m(str2(maxAllowed))})`,
        explanation: `Under the Dutch Besluit vergoeding voor buitengerechtelijke incassokosten (BIK), the maximum collection fee on a principal of ${m(str2(principal))} is ${m(str2(maxAllowed))} (15% on first €2,500, min. €40). This invoice charges ${m(str2(chargedFee))} (+${m(str2(excess))} above the legal maximum).`,
        expected: `${m(str2(maxAllowed))} at most (Dutch BIK staffel)`,
        actual: m(str2(chargedFee)),
        difference: formatMoney(str2(excess), "EUR", { signed: true }),
        evidence: [
          `Underlying principal: ${m(str2(principal))}`,
          `Statutory BIK sliding-scale maximum: ${m(str2(maxAllowed))}`,
          `Charged collection/dunning lines: ${feeLines.map((l) => `"${l.description}" (${m(l.total)})`).join(", ")}`,
        ],
        confidence: "high",
        confidenceReason: "Exact arithmetic calculation against the statutory Dutch BIK sliding scale.",
        uncertainty: "Verify whether the fee covers multiple combined overdue invoices not listed on this single document.",
        recommendedAction: "Dispute any amount above the statutory BIK cap—and note that collection fees also require a prior 14-day formal notice (14-dagenbrief) and cannot include 21% VAT if the creditor is VAT-registered.",
        amountAtRisk: str2(excess),
      })
    );
  }

  // 2. Check Wet kwaliteit incassodiensten (WKI) cumulative installment stacking within 180 days
  const invDate = parseISO(inv.date);
  if (invDate !== null) {
    const priorBikBills = priorInvoices(inv, ctx).filter((p) => {
      const pDate = parseISO(p.date);
      if (pDate === null || Math.abs(daysBetween(pDate, invDate)) > 180) return false;
      return p.lineItems.some((l) => BIK_WORDS.test(l.description) && D(l.total).gt(0));
    });

    if (priorBikBills.length >= 1) {
      out.push(
        makeFinding(inv, {
          ruleId: "unexpected_fee",
          key: "nl-wki-cumulation",
          classification: "REVIEW_NEEDED",
          severity: "high",
          title: `Possible WKI cumulative collection-fee stacking (${priorBikBills.length + 1} notices in 180 days)`,
          explanation: `${inv.vendorName} has charged collection/dunning fees across ${priorBikBills.length + 1} invoices within 180 days. Under the Dutch Wet kwaliteit incassodiensten (WKI), stacking full €40+ collection fees onto consecutive recurring installments is strictly limited.`,
          expected: "WKI-compliant capped cumulative fee across recurring installments",
          actual: `${priorBikBills.length + 1} separate collection-fee charges in 180 days`,
          difference: formatMoney(str2(chargedFee), "EUR", { signed: true }),
          evidence: [
            `Earlier collection-fee bills: ${priorBikBills.map((p) => `${p.number} (${p.date})`).join(", ")}`,
            `Current bill: ${inv.number} (${inv.date}) charging ${m(str2(chargedFee))}`,
          ],
          confidence: "high",
          confidenceReason: "Cross-invoice detection of repeated statutory collection charges within a 6-month window.",
          uncertainty: "Separate unrelated contracts with the same vendor may be assessed independently under WKI.",
          recommendedAction: "Ask the vendor or collection agency to recalculate cumulative fees in accordance with the Dutch Wet kwaliteit incassodiensten (WKI) installment cap.",
          amountAtRisk: str2(chargedFee),
        })
      );
    }
  }

  return out;
}
