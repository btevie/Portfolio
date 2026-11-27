import type { AuditFinding } from "../../types";
import { priorInvoices } from "../history";
import { D, formatMoney, str2, sum } from "../money";
import type { Rule } from "../types";
import { makeFinding } from "./util";

const REDUCED_VAT_9_PATTERNS = [
  /\b(lunch|broodjes|catering|bakkerij|voedingsmiddelen|boodschappen|supermarkt|groceries|food|non-alcoholic|frisdrank|koffie|thee)\b/i,
  /\b(boek|boeken|vakliteratuur|tijdschrift|krant|kranten|book|books|newspaper|periodical)\b/i,
  /\b(treinkaartje|treinreis|openbaar vervoer|buskaartje|taxi|passenger transport|ns zakelijk)\b/i,
  /\b(kapper|kappersbehandeling|fietsenmaker|fietsreparatie|schoenmaker|schoenreparatie)\b/i,
];

const EU_CROSS_BORDER_VENDORS = /\b(aws emea|amazon web services|microsoft ireland|google ireland|google cloud|stripe|shopify|adobe|slack|atlassian|hubspot|figma|notion|vercel|webflow|openai|anthropic|meta ireland|linkedin ireland|zoom|dropbox|github|digitalocean|cloudflare|mailchimp|intercom|zendesk|salesforce|pipedrive|miro)\b/i;
const REVERSE_CHARGE_WORDS = /\b(btw verlegd|reverse charge|reverse-charge|intracommunautair|intra-community)\b/i;
const ALCOHOL_OR_EXCLUSION = /\b(alcohol|wijn|bier|sterke drank|wine|beer|spirits|borrel)\b/i;

export const taxRule: Rule = (inv, ctx) => {
  const out: AuditFinding[] = [];
  const lines = inv.lineItems.map((l) => ({ ...l, rate: l.taxRate ?? inv.taxRate }));
  const rated = lines.filter((l) => l.rate !== undefined);
  if (rated.length === 0) return out; // no stated rate → nothing to validate against

  const gross = sum(lines.map((l) => D(l.total)));
  const discount = D(inv.discounts);
  const groups = new Map<string, ReturnType<typeof D>>();
  for (const l of rated) {
    const rate = D(l.rate!).toString();
    groups.set(rate, (groups.get(rate) ?? D(0)).plus(D(l.total)));
  }

  let expected = D(0);
  const parts: string[] = [];
  for (const [rate, base] of groups) {
    // Allocate invoice-wide discounts proportionally across every line, including
    // lines without a stated rate; their share reduces their own tax base (zero).
    const share = gross.isZero() ? D(0) : discount.times(base).div(gross);
    const taxable = base.minus(share);
    const tax = taxable.times(D(rate)).div(100);
    expected = expected.plus(tax);
    parts.push(`${rate}% on ${str2(taxable)} = ${str2(tax)}`);
  }
  const tol = D(ctx.config.roundingTolerance).times(groups.size + 1);
  const diff = D(inv.taxAmount).minus(expected);
  const m = (v: Parameters<typeof D>[0]) => formatMoney(D(v), inv.currency);

  if (diff.abs().gt(tol)) {
    out.push(makeFinding(inv, {
      ruleId: "tax", key: "amount",
      classification: "LIKELY_ERROR", severity: diff.abs().gte(20) ? "high" : "medium",
      title: "Tax amount doesn't match the stated rate",
      explanation: `Applying the stated tax rate${groups.size > 1 ? "s" : ""} to the taxable amount gives ${m(expected)}, but the invoice charges ${m(inv.taxAmount)}.`,
      expected: m(expected), actual: m(inv.taxAmount), difference: formatMoney(diff, inv.currency),
      evidence: parts,
      confidence: "medium",
      confidenceReason: "The arithmetic is exact, but we only know the rates printed on the invoice.",
      uncertainty: "Some lines may be tax-exempt or reverse-charged without being marked, which would legitimately change the tax amount.",
      recommendedAction: "Ask the vendor which lines are taxable and at what rate, and request a corrected invoice if the amount is wrong.",
      amountAtRisk: diff.gt(0) ? str2(diff) : "0.00",
    }));
  }

  // Dutch 21% vs 9% reduced BTW check
  for (const line of rated) {
    if (!D(line.rate!).eq(21) || D(line.total).lte(0)) continue;
    if (ALCOHOL_OR_EXCLUSION.test(line.description)) continue;
    if (!REDUCED_VAT_9_PATTERNS.some((rx) => rx.test(line.description))) continue;

    const lineBase = D(line.total);
    const billedTax = lineBase.times("0.21");
    const reducedTax = lineBase.times("0.09");
    const overcharge = billedTax.minus(reducedTax);

    out.push(makeFinding(inv, {
      ruleId: "tax",
      key: `nl-vat9-${line.id}`,
      classification: "REVIEW_NEEDED",
      severity: overcharge.gte(15) ? "medium" : "low",
      title: `21% VAT charged on likely 9% Dutch reduced-rate item: "${line.description}"`,
      explanation: `This line is taxed at 21% (${m(billedTax)}), but food, non-alcoholic catering, books, passenger transport, and basic repairs generally qualify for the 9% Dutch BTW rate (${m(reducedTax)}).`,
      expected: `9% (${m(reducedTax)})`,
      actual: `21% (${m(billedTax)})`,
      difference: formatMoney(overcharge, inv.currency, { signed: true }),
      evidence: [
        `Line "${line.description}": ${m(lineBase)} taxed at 21%`,
        `9% BTW would be ${m(reducedTax)} (12 percentage points lower)`,
      ],
      confidence: "medium",
      confidenceReason: "The line description matches standard Dutch 9% BTW categories while 21% was applied.",
      uncertainty: "21% VAT may still apply if the line includes alcoholic beverages, non-food merchandise, or full-service event hosting.",
      recommendedAction: "Check whether the items qualify for the 9% reduced BTW rate and ask the supplier for a corrected invoice if 21% was charged in error.",
      amountAtRisk: str2(overcharge),
    }));
  }

  // EU B2B reverse-charge (BTW verlegd) check
  const hasReverseChargeLabel = inv.lineItems.some((l) => REVERSE_CHARGE_WORDS.test(l.description));
  if (hasReverseChargeLabel && D(inv.taxAmount).gt(tol)) {
    out.push(makeFinding(inv, {
      ruleId: "tax",
      key: "reverse-charge-taxed",
      classification: "LIKELY_ERROR",
      severity: D(inv.taxAmount).gte(20) ? "high" : "medium",
      title: "Tax charged on an invoice marked reverse-charge (BTW verlegd)",
      explanation: `An invoice line references reverse-charge (BTW verlegd), yet ${m(inv.taxAmount)} in tax was charged.`,
      expected: m("0"),
      actual: m(inv.taxAmount),
      difference: formatMoney(inv.taxAmount, inv.currency, { signed: true }),
      evidence: [`Stated tax amount: ${m(inv.taxAmount)}`, "Line description indicates reverse-charge / BTW verlegd"],
      confidence: "high",
      confidenceReason: "Reverse-charge (BTW verlegd) supplies must be billed at 0% VAT.",
      uncertainty: "Verify that only part of the invoice was reverse-charged while other lines were locally taxable.",
      recommendedAction: "Ask the supplier to credit the charged VAT and reissue the invoice at 0% BTW verlegd.",
      amountAtRisk: str2(D(inv.taxAmount)),
    }));
  } else if (inv.currency === "EUR" && D(inv.taxAmount).gt(tol) && EU_CROSS_BORDER_VENDORS.test(inv.vendorName)) {
    out.push(makeFinding(inv, {
      ruleId: "tax",
      key: "eu-b2b-reverse-charge",
      classification: "REVIEW_NEEDED",
      severity: D(inv.taxAmount).gte(25) ? "medium" : "low",
      title: `VAT charged by cross-border supplier ${inv.vendorName} (check EU B2B BTW verlegd)`,
      explanation: `${inv.vendorName} charged ${m(inv.taxAmount)} in VAT. For Dutch VAT-registered businesses (B2B), cross-border EU/international SaaS invoices should normally be billed at 0% reverse-charge (BTW verlegd)—VAT charged in error cannot be reclaimed on a Dutch BTW return.`,
      expected: `0% BTW verlegd (${m("0")})`,
      actual: m(inv.taxAmount),
      difference: formatMoney(inv.taxAmount, inv.currency, { signed: true }),
      evidence: [`Vendor: ${inv.vendorName}`, `VAT charged: ${m(inv.taxAmount)}`],
      confidence: "medium",
      confidenceReason: "This supplier commonly issues cross-border EU B2B invoices where reverse-charge applies once your VAT ID is on file.",
      uncertainty: "If you are buying as an individual consumer (B2C) or VAT-exempt entity without a VAT ID on file, charging local VAT is required.",
      recommendedAction: "If this is a B2B purchase, add your Dutch BTW-nummer to your vendor billing profile and request a credit note for the charged VAT.",
      amountAtRisk: str2(D(inv.taxAmount)),
    }));
  }

  // rate drift versus this vendor's earlier invoices
  const prior = priorInvoices(inv, ctx);
  const last = prior[prior.length - 1];
  const previousRates = last ? [...new Set((last.lineItems.length ? last.lineItems.map((l) => l.taxRate ?? last.taxRate) : [last.taxRate]).filter((r): r is string => r !== undefined).map((r) => D(r).toString()))] : [];
  const currentRates = [...groups.keys()];
  const lastRate = previousRates.length === 1 ? previousRates[0] : undefined;
  const thisRate = currentRates.length === 1 ? currentRates[0] : undefined;
  if (lastRate && thisRate && !D(lastRate).eq(D(thisRate))) {
    out.push(makeFinding(inv, {
      ruleId: "tax", key: "rate-change",
      classification: "REVIEW_NEEDED", severity: "low",
      title: "Tax rate differs from this vendor's previous invoice",
      explanation: `This invoice applies ${thisRate}% tax; the previous invoice from ${inv.vendorName} applied ${lastRate}%.`,
      expected: `${lastRate}%`, actual: `${thisRate}%`, difference: `${D(thisRate).minus(D(lastRate)).toString()} pts`,
      evidence: [`Previous invoice ${last.number}: ${lastRate}%`, `This invoice ${inv.number}: ${thisRate}%`],
      confidence: "medium",
      confidenceReason: "The rates are printed on both invoices; whether the change is justified is unknown.",
      uncertainty: "Tax rates change legitimately (new legislation, different service type or customer location).",
      recommendedAction: "Confirm the applicable rate for this service; no action is needed if the vendor changed it for a known reason.",
    }));
  }
  return out;
};
