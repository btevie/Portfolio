import { D, formatMoney } from "./audit/money";
import { daysBetween, normalizeInvoiceNumber, parseISO } from "./audit/normalize";
import type { Invoice, ISODate } from "./types";

/**
 * Recurring-bill signals from a vendor's own history. Pure arithmetic on dates and totals: nothing is predicted by a
 * model and nothing is assumed about contracts. Each signal says what it compared, so the user can check it.
 * A vendor is only watched when its bills arrive about once a month (at least 3 bills, every gap 20 to 40 days).
 */
export type RecurringKind = "missing" | "double" | "creep";

export interface RecurringSignal {
  kind: RecurringKind;
  vendorId: string;
  vendorName: string;
  currency: string;
  headline: string;
  detail: string;
  figures: { label: string; value: string }[];
  /** Sort weight: bigger = look at first. */
  weight: number;
}

const GRACE_DAYS = 7;
const CREEP_PCT = 5;

export function recurringSignals(invoices: Invoice[], asOf: ISODate): RecurringSignal[] {
  const groups = new Map<string, Invoice[]>();
  for (const i of invoices) {
    if (i.isCredit || i.extraction === "mock" || parseISO(i.date) === null) continue;
    const k = `${i.vendorId}|${i.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const out: RecurringSignal[] = [];
  const today = parseISO(asOf);
  if (today === null) return out;

  for (const list of groups.values()) {
    // Oldest first; a re-sent copy (same number and total) is one bill, not two.
    const sorted = [...list].sort((a, b) => (parseISO(a.date)! - parseISO(b.date)!) || a.createdAt - b.createdAt);
    const bills = sorted.filter((b, n) => !sorted.slice(0, n).some((p) => normalizeInvoiceNumber(p.number) !== "" && normalizeInvoiceNumber(p.number) === normalizeInvoiceNumber(b.number) && D(p.total).equals(D(b.total))));
    if (bills.length < 3) continue;
    const gaps = bills.slice(1).map((b, n) => daysBetween(parseISO(bills[n].date)!, parseISO(b.date)!));
    const regular = gaps.slice(0, -1); // the newest gap may be a double bill, so regularity is judged on the earlier ones
    if (regular.length < 2 || !regular.every((g) => g >= 20 && g <= 40)) continue;
    const sortedGaps = [...regular].sort((a, b) => a - b);
    const typical = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const first = bills[0], last = bills[bills.length - 1], prev = bills[bills.length - 2];
    const v = { vendorId: last.vendorId, vendorName: last.vendorName, currency: last.currency };
    const m = (x: string) => formatMoney(x, last.currency);

    const lastGap = gaps[gaps.length - 1];
    if (lastGap < 15) {
      out.push({ ...v, kind: "double", weight: 3, headline: `Two bills ${lastGap} day${lastGap === 1 ? "" : "s"} apart`,
        detail: `${last.vendorName} usually bills about every ${typical} days. ${prev.number} and ${last.number} arrived close together. This can be a legitimate extra charge, a re-issue, or a double bill.`,
        figures: [{ label: prev.number, value: `${m(prev.total)} · ${prev.date}` }, { label: last.number, value: `${m(last.total)} · ${last.date}` }] });
    }

    const nextDue = parseISO(last.date)! + typical * 86_400_000;
    const late = Math.floor((today - nextDue) / 86_400_000);
    if (late > GRACE_DAYS) {
      out.push({ ...v, kind: "missing", weight: 1, headline: `No new bill, ${late} days past the usual date`,
        detail: `${last.vendorName} has billed every ~${typical} days (${bills.length} bills). The last was ${last.date}. A missing bill can mean it was cancelled, sent to another address, or not recorded here. It can also mean you are still being charged elsewhere, so check your statement.`,
        figures: [{ label: "Last bill", value: `${last.number} · ${last.date}` }, { label: "Expected around", value: new Date(nextDue).toISOString().slice(0, 10) }] });
    }

    const firstTotal = D(first.total);
    if (!firstTotal.isZero()) {
      const pctUp = D(last.total).minus(firstTotal).div(firstTotal).times(100);
      if (pctUp.gte(CREEP_PCT)) {
        out.push({ ...v, kind: "creep", weight: 2, headline: `Up ${pctUp.toFixed(1)}% since the first bill`,
          detail: `Compared with the first of ${bills.length} bills here, not only the previous one, so small rises that each looked fine add up. Totals include tax and fees. A rise can be agreed (plan change, indexation), so check your contract.`,
          figures: [{ label: `First (${first.date})`, value: m(first.total) }, { label: `Latest (${last.date})`, value: m(last.total) }, { label: "Difference", value: formatMoney(D(last.total).minus(firstTotal), last.currency, { signed: true }) }] });
      }
    }
  }
  return out.sort((a, b) => b.weight - a.weight || a.vendorName.localeCompare(b.vendorName));
}
