import { forecastVendorSpend } from "./audit/forecasting";
import { analyzeVendorForensics } from "./audit/forensics";
import { D, formatMoney, str2 } from "./audit/money";
import { daysBetween, parseISO } from "./audit/normalize";
import type { Invoice, Vendor } from "./types";

export interface NegotiationPlaybook {
  annualizedSpend: string;
  onTimeRatePct: number;
  priceCreepPct: number;
  forensicLabel: string;
  volatilityPct: number;
  daysToNoticeDeadline: number | null;
  leverageScore: "Strong" | "Moderate" | "Low";
  talkingPoints: string[];
}

export function buildNegotiationPlaybook(vendor: Vendor, invoices: Invoice[], todayIso: string): NegotiationPlaybook | null {
  const all = invoices
    .filter((i) => i.vendorId === vendor.id && !i.isCredit && i.extraction !== "mock")
    .sort((a, b) => (parseISO(a.date) ?? 0) - (parseISO(b.date) ?? 0));
  if (all.length === 0) return null;

  // Overbill never converts currencies, so every figure here uses only the invoices in the vendor's latest currency.
  const currency = all[all.length - 1].currency;
  const valid = all.filter((i) => i.currency === currency);
  const totalSpend = valid.reduce((acc, i) => acc.plus(D(i.total)), D(0));
  const firstMs = parseISO(valid[0].date);
  const lastMs = parseISO(valid[valid.length - 1].date);
  const spanDays = firstMs !== null && lastMs !== null ? Math.max(30, daysBetween(firstMs, lastMs) + 30) : 365;
  const annualized = totalSpend.times(365).div(spanDays);

  const settled = valid.filter((i) => i.paymentStatus === "paid");
  const onTimeRatePct = valid.length > 0 ? Math.round((settled.length / valid.length) * 100) : 0;

  const firstNet = D(valid[0].subtotal).minus(D(valid[0].discounts));
  const latestNet = D(valid[valid.length - 1].subtotal).minus(D(valid[valid.length - 1].discounts));
  const priceCreepPct =
    valid.length >= 2 && firstNet.gt(0)
      ? Number(latestNet.minus(firstNet).div(firstNet).times(100).toFixed(1))
      : 0;

  const forensics = analyzeVendorForensics(valid);
  const forecast = forecastVendorSpend(valid);

  let daysToNoticeDeadline: number | null = null;
  const todayMs = parseISO(todayIso);
  const renewalMs = vendor.contract?.renewalDate ? parseISO(vendor.contract.renewalDate) : null;
  if (todayMs !== null && renewalMs !== null) {
    const noticeDays = vendor.contract?.noticeDays ?? 30;
    const deadlineMs = renewalMs - noticeDays * 86_400_000;
    daysToNoticeDeadline = daysBetween(todayMs, deadlineMs);
  }

  const talkingPoints: string[] = [];
  if (annualized.gte(1000)) {
    talkingPoints.push(`Projected annual spend is ~${formatMoney(str2(annualized), currency)} across ${valid.length} invoice(s)—use your annual volume to request a 5–10% loyalty discount or rate freeze.`);
  }
  if (onTimeRatePct >= 80 && valid.length >= 2) {
    talkingPoints.push(`${onTimeRatePct}% of recorded bills are settled—highlight your reliable payment track record when requesting better payment terms or fee waivers.`);
  }
  if (priceCreepPct >= 8) {
    talkingPoints.push(`Net charges have risen +${priceCreepPct}% since your first recorded bill—ask to benchmark your rate against current new-customer pricing.`);
  }
  if (daysToNoticeDeadline !== null && daysToNoticeDeadline >= 0 && daysToNoticeDeadline <= 45) {
    talkingPoints.push(`Your cancellation notice window closes in ${daysToNoticeDeadline} day(s)—initiate renewal negotiations now while you still have full leverage to switch.`);
  }
  if (forecast) {
    talkingPoints.push(`OLS econometric forecast: next bill expected around ${formatMoney(forecast.projectedNext, currency)} (95% CI: ${formatMoney(forecast.ci95Low, currency)}–${formatMoney(forecast.ci95High, currency)}), projecting ${formatMoney(forecast.projectedAnnualBurn, currency)} over the next 12 bills.`);
  }
  if (forensics.anomalyLabel !== "Consistent") {
    talkingPoints.push(`Billing variance is elevated (${forensics.volatilityPct}% volatility)—request an itemized rate card or fixed monthly cap.`);
  }
  if (talkingPoints.length === 0) {
    talkingPoints.push(`Pricing and billing cadence are steady across ${valid.length} bill(s). Keep monitoring for silent promo rollovers or unbundled fees.`);
  }

  const strong = (annualized.gte(1500) && onTimeRatePct >= 75) || (daysToNoticeDeadline !== null && daysToNoticeDeadline >= 0 && daysToNoticeDeadline <= 45);
  const moderate = valid.length >= 2 || annualized.gte(500);

  return {
    annualizedSpend: formatMoney(str2(annualized), currency),
    onTimeRatePct,
    priceCreepPct,
    forensicLabel: forensics.anomalyLabel,
    volatilityPct: forensics.volatilityPct,
    daysToNoticeDeadline,
    leverageScore: strong ? "Strong" : moderate ? "Moderate" : "Low",
    talkingPoints,
  };
}
