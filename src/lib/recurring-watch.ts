import { D, formatMoney } from "./audit/money";
import { daysBetween, normalizeInvoiceNumber, normalizeVendor, parseISO } from "./audit/normalize";
import type { Invoice, ISODate } from "./types";

export type RecurringKind = "missing" | "double" | "creep" | "ghost_seats" | "overlap";

export interface RecurringSignal {
  kind: RecurringKind;
  vendorId: string;
  vendorName: string;
  currency: string;
  headline: string;
  detail: string;
  figures: { label: string; value: string }[];
  weight: number;
}

const GRACE_DAYS = 7;
const CREEP_PCT = 5;
const SEAT_WORDS = /\b(seat|seats|user|users|license|licenses|licentie|licenties|gebruiker|gebruikers|member|members)\b/i;

const OVERLAP_CLUSTERS: { category: string; keywords: string[] }[] = [
  { category: "roadside assistance", keywords: ["anwb", "route mobiel", "pechhulp", "mobiliteitsgarantie", "wegenwacht", "allianz global assistance"] },
  { category: "video conferencing", keywords: ["zoom", "microsoft teams", "webex", "google meet", "whereby"] },
  { category: "cloud storage", keywords: ["dropbox", "google one", "icloud", "box.com", "onedrive"] },
  { category: "e-signature", keywords: ["docusign", "adobe sign", "pandadoc", "hellosign", "signrequest", "yousign"] },
  { category: "project & task tracking", keywords: ["asana", "trello", "monday.com", "clickup", "jira", "linear"] },
];

export function recurringSignals(invoices: Invoice[], asOf: ISODate): RecurringSignal[] {
  const valid = invoices.filter((i) => !i.isCredit && i.extraction !== "mock" && parseISO(i.date) !== null);
  const groups = new Map<string, Invoice[]>();
  for (const i of valid) {
    const k = `${i.vendorId}|${i.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const out: RecurringSignal[] = [];
  const today = parseISO(asOf);
  if (today === null) return out;

  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => (parseISO(a.date)! - parseISO(b.date)!) || a.createdAt - b.createdAt);
    const bills = sorted.filter((b, n) => !sorted.slice(0, n).some((p) => normalizeInvoiceNumber(p.number) !== "" && normalizeInvoiceNumber(p.number) === normalizeInvoiceNumber(b.number) && D(p.total).equals(D(b.total))));
    if (bills.length < 3) continue;
    const gaps = bills.slice(1).map((b, n) => daysBetween(parseISO(bills[n].date)!, parseISO(b.date)!));
    const regular = gaps.slice(0, -1);
    if (regular.length < 1 || !regular.every((g) => g >= 20 && g <= 40)) continue;
    const sortedGaps = [...regular].sort((a, b) => a - b);
    const typical = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const first = bills[0], last = bills[bills.length - 1], prev = bills[bills.length - 2];
    const v = { vendorId: last.vendorId, vendorName: last.vendorName, currency: last.currency };
    const m = (x: string) => formatMoney(x, last.currency);

    const lastGap = gaps[gaps.length - 1];
    if (lastGap < 15) {
      out.push({
        ...v, kind: "double", weight: 3,
        headline: `Two bills ${lastGap} day${lastGap === 1 ? "" : "s"} apart`,
        detail: `${last.vendorName} usually bills about every ${typical} days. ${prev.number} and ${last.number} arrived close together. This can be a legitimate extra charge, a re-issue, or a double bill.`,
        figures: [{ label: prev.number, value: `${m(prev.total)} · ${prev.date}` }, { label: last.number, value: `${m(last.total)} · ${last.date}` }],
      });
    }

    const nextDue = parseISO(last.date)! + typical * 86_400_000;
    const late = Math.floor((today - nextDue) / 86_400_000);
    // A newest gap that is neither monthly nor a short double-bill gap means the pattern already broke: do not call the next bill "missing".
    if (late > GRACE_DAYS && lastGap >= 20 && lastGap <= 40) {
      out.push({
        ...v, kind: "missing", weight: 1,
        headline: `No new bill, ${late} days past the usual date`,
        detail: `${last.vendorName} has billed every ~${typical} days (${bills.length} bills). The last was ${last.date}. A missing bill can mean it was cancelled, sent to another address, or not recorded here.`,
        figures: [{ label: "Last bill", value: `${last.number} · ${last.date}` }, { label: "Expected around", value: new Date(nextDue).toISOString().slice(0, 10) }],
      });
    }

    const firstTotal = D(first.total);
    if (!firstTotal.isZero()) {
      const pctUp = D(last.total).minus(firstTotal).div(firstTotal).times(100);
      if (pctUp.gte(CREEP_PCT)) {
        out.push({
          ...v, kind: "creep", weight: 2,
          headline: `Up ${pctUp.toFixed(1)}% since the first bill`,
          detail: `Compared with the first of ${bills.length} bills here, not only the previous one, so small rises that each looked fine add up.`,
          figures: [{ label: `First (${first.date})`, value: m(first.total) }, { label: `Latest (${last.date})`, value: m(last.total) }, { label: "Difference", value: formatMoney(D(last.total).minus(firstTotal), last.currency, { signed: true }) }],
        });
      }
    }

    if (bills.length >= 4) {
      const recent4 = bills.slice(-4);
      const seatCounts = recent4.map((b) => {
        const seatLine = b.lineItems.find((l) => SEAT_WORDS.test(l.description) && D(l.quantity).gte(3));
        return seatLine ? D(seatLine.quantity).toString() : null;
      });
      if (seatCounts[0] !== null && seatCounts.every((q) => q === seatCounts[0])) {
        const seatLine = last.lineItems.find((l) => SEAT_WORDS.test(l.description) && D(l.quantity).gte(3))!;
        out.push({
          ...v, kind: "ghost_seats", weight: 1.5,
          headline: `${seatCounts[0]} seats unchanged across ${recent4.length} bills`,
          detail: `${last.vendorName} has billed for ${seatCounts[0]} seats ("${seatLine.description}") with zero change across the last ${recent4.length} bills. Static seat counts often include departed staff or inactive accounts.`,
          figures: [{ label: "Billed seats", value: `${seatCounts[0]} × ${m(seatLine.unitPrice)}` }, { label: "Line total", value: m(seatLine.total) }],
        });
      }
    }
  }

  const recentBills = valid.filter((i) => Math.abs(daysBetween(parseISO(i.date)!, today)) <= 65);
  for (const cluster of OVERLAP_CLUSTERS) {
    const matchedByVendor = new Map<string, Invoice>();
    for (const inv of recentBills) {
      const norm = normalizeVendor(inv.vendorName);
      if (cluster.keywords.some((kw) => norm.includes(kw)) && !matchedByVendor.has(inv.vendorId)) {
        matchedByVendor.set(inv.vendorId, inv);
      }
    }
    if (matchedByVendor.size >= 2) {
      const matched = [...matchedByVendor.values()];
      const primary = matched[0];
      out.push({
        vendorId: primary.vendorId,
        vendorName: matched.map((x) => x.vendorName).join(" & "),
        currency: primary.currency,
        kind: "overlap",
        weight: 2.2,
        headline: `Possible overlapping ${cluster.category} subscriptions`,
        detail: `You have recent bills from multiple ${cluster.category} providers (${matched.map((x) => x.vendorName).join(", ")}). Check whether both are needed or if one duplicates existing coverage.`,
        figures: matched.slice(0, 3).map((x) => ({ label: x.vendorName, value: `${formatMoney(x.total, x.currency)} · ${x.date}` })),
      });
    }
  }

  return out.sort((a, b) => b.weight - a.weight || a.vendorName.localeCompare(b.vendorName));
}
