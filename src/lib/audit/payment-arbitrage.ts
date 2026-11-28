import type { AuditFinding, Invoice } from "../types";
import { scaled } from "./currency-scale";
import { D, formatMoney, str2 } from "./money";
import { daysBetween, parseISO } from "./normalize";
import { makeFinding } from "./rules/util";

// Matches "2% betalingskorting binnen 8 dagen", "2% Skonto 10 Tage", "2% early payment discount within 10 days", or "2/10 net 30"
const NL_EN_DISCOUNT_RX =
  /(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:betalingskorting|korting|skonto|early[- ]payment\s+discount|discount)\s*(?:bij\s+betaling\s+)?(?:binnen|within|innerhalb(?:\s+von)?|in)?\s*(\d{1,2})\s*(?:dag|dagen|day|days|tage|tagen)/i;
const SLASH_TERM_RX = /\b(\d{1,2}(?:[.,]\d{1,2})?)\s*\/\s*(\d{1,2})\s*(?:net|netto)\s*(\d{1,3})\b/i;
const KREDIETBEPERKING_RX = /\bkredietbeperking\b/i;

export function paymentArbitrageFindings(inv: Invoice): AuditFinding[] {
  const total = D(inv.total);
  if (total.lte(0) || inv.paymentStatus === "paid") return [];

  const invDate = parseISO(inv.date);
  const dueDate = parseISO(inv.dueDate);
  const netDays = invDate !== null && dueDate !== null ? Math.max(1, daysBetween(invDate, dueDate)) : 30;

  let discountPct: number | null = null;
  let discountDays: number | null = null;
  let effectiveNetDays = netDays;
  let matchedSource = "";

  for (const line of inv.lineItems) {
    const m1 = line.description.match(NL_EN_DISCOUNT_RX);
    if (m1) {
      discountPct = Number((m1.at(1) ?? "0").replace(",", "."));
      discountDays = Number(m1.at(2) ?? "0");
      matchedSource = line.description;
      break;
    }
    const m2 = line.description.match(SLASH_TERM_RX);
    if (m2) {
      discountPct = Number((m2.at(1) ?? "0").replace(",", "."));
      discountDays = Number(m2.at(2) ?? "0");
      effectiveNetDays = Number(m2.at(3) ?? "30");
      matchedSource = line.description;
      break;
    }
  }

  const out: AuditFinding[] = [];
  const m = (v: string) => formatMoney(v, inv.currency);

  if (discountPct !== null && discountDays !== null && discountPct > 0 && discountPct <= 15 && effectiveNetDays > discountDays) {
    const d = discountPct / 100;
    const windowSpread = effectiveNetDays - discountDays;
    const impliedApr = (d / (1 - d)) * (365 / windowSpread) * 100;
    const savings = total.times(D(d.toFixed(4)));

    if (savings.gte(scaled(5, inv.currency)) && impliedApr >= 8) {
      out.push(
        makeFinding(inv, {
          ruleId: "dates",
          key: "early-pay-arbitrage",
          classification: "REVIEW_NEEDED",
          severity: savings.gte(scaled(50, inv.currency)) ? "medium" : "low",
          title: `Early-payment arbitrage: save ${m(str2(savings))} (${impliedApr.toFixed(1)}% implied APR)`,
          explanation: `This invoice offers a ${discountPct}% early-payment discount (betalingskorting / Skonto) if settled within ${discountDays} day(s) instead of ${effectiveNetDays} days. Paying ${windowSpread} day(s) early captures ${m(str2(savings))}—an annualized risk-free return of ${impliedApr.toFixed(1)}% APR.`,
          expected: `Pay within ${discountDays} days to save ${m(str2(savings))}`,
          actual: `Full ${m(inv.total)} due in ${effectiveNetDays} days`,
          difference: formatMoney(str2(savings), inv.currency, { signed: true }),
          evidence: [
            `Detected payment term: "${matchedSource}"`,
            `Discount window: ${discountDays} days vs net ${effectiveNetDays} days (${windowSpread}-day spread)`,
            `Implied annualized yield: ${impliedApr.toFixed(1)}% APR`,
          ],
          confidence: "high",
          confidenceReason: "Exact financial arbitrage yield formula computed from stated early-payment terms.",
          uncertainty: "Confirm whether the discount applies to the gross total or net subtotal excluding VAT.",
          recommendedAction: `Schedule payment within ${discountDays} days of ${inv.date} and deduct the ${discountPct}% betalingskorting (${m(str2(savings))}).`,
          amountAtRisk: str2(savings),
        })
      );
    }
  }

  // Also flag Dutch "Kredietbeperking" surcharge lines (surcharge added unless paid early)
  const kbLine = inv.lineItems.find((l) => KREDIETBEPERKING_RX.test(l.description) && D(l.total).gt(0));
  if (kbLine) {
    out.push(
      makeFinding(inv, {
        ruleId: "unexpected_fee",
        key: `kredietbeperking-${kbLine.id}`,
        classification: "REVIEW_NEEDED",
        severity: "low",
        title: `Kredietbeperking surcharge (${m(kbLine.total)}) — deductible if paid on time`,
        explanation: `Line "${kbLine.description}" adds a Dutch kredietbeperking surcharge of ${m(kbLine.total)}. Under standard Dutch commercial terms, you are entitled to deduct this surcharge when paying within the stated prompt-payment window.`,
        expected: `Deduct ${m(kbLine.total)} if paid within the prompt-payment period`,
        actual: `${m(kbLine.total)} included in total`,
        difference: formatMoney(kbLine.total, inv.currency, { signed: true }),
        evidence: [`Kredietbeperking line: "${kbLine.description}" = ${m(kbLine.total)}`],
        confidence: "high",
        confidenceReason: "Explicit Dutch kredietbeperking clause identified on invoice line.",
        uncertainty: "If payment is made after the prompt-payment deadline, the surcharge becomes payable.",
        recommendedAction: "Pay within the stated prompt-payment term and deduct the kredietbeperking amount.",
        amountAtRisk: str2(D(kbLine.total)),
      })
    );
  }

  return out;
}
