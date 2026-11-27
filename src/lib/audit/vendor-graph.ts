import type { AuditFinding, Invoice } from "../types";
import { isEarlier } from "./history";
import { D, formatMoney, str2 } from "./money";
import { daysBetween, normalizeDescription, normalizeInvoiceNumber, normalizeVendor, parseISO } from "./normalize";
import type { AuditContext } from "./types";
import { makeFinding } from "./rules/util";

function tokenSet(inv: Invoice): Set<string> {
  return new Set(
    inv.lineItems
      .flatMap((l) => normalizeDescription(l.description).split(/\s+/))
      .filter((w) => w.length >= 4 && !/^\d+$/.test(w))
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / Math.min(a.size, b.size);
}

export function vendorGraphFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  const out: AuditFinding[] = [];
  const myVendor = normalizeVendor(inv.vendorName);
  const myNum = normalizeInvoiceNumber(inv.number);
  const myDate = parseISO(inv.date);
  const myTotal = D(inv.total);
  if (myDate === null || myTotal.lte(0)) return out;

  const myTokens = tokenSet(inv);
  const m = (v: string) => formatMoney(v, inv.currency);

  const crossVendorPeers = ctx.invoices.filter(
    (o) =>
      o.id !== inv.id &&
      !o.isCredit &&
      o.extraction !== "mock" &&
      o.currency === inv.currency &&
      normalizeVendor(o.vendorName) !== myVendor &&
      isEarlier(o, inv)
  );

  for (const peer of crossVendorPeers) {
    const peerDate = parseISO(peer.date);
    if (peerDate === null) continue;
    const gap = Math.abs(daysBetween(peerDate, myDate));
    if (gap > 35) continue;

    const sameAmount = D(peer.total).eq(myTotal);
    const peerNum = normalizeInvoiceNumber(peer.number);
    const sameRef = myNum.length >= 4 && peerNum === myNum;
    const lineOverlap = overlapScore(myTokens, tokenSet(peer));

    if (sameAmount && (sameRef || lineOverlap >= 0.6)) {
      out.push(
        makeFinding(inv, {
          ruleId: "duplicate_invoice",
          key: `cross-vendor-${peer.id}`,
          classification: "REVIEW_NEEDED",
          severity: sameRef ? "high" : "medium",
          title: `Cross-vendor duplicate match with "${peer.vendorName}" (${m(inv.total)})`,
          explanation: `This invoice from ${inv.vendorName} (${inv.number}, ${m(inv.total)}) matches an earlier bill from a differently named entity, ${peer.vendorName} (${peer.number} on ${peer.date}), with ${sameRef ? "the same invoice reference" : `${Math.round(lineOverlap * 100)}% overlapping line descriptions`}. Vendors sometimes bill under both a trading name and a holding B.V.`,
          expected: "Single billing entity per charge",
          actual: `Billed by both ${peer.vendorName} and ${inv.vendorName}`,
          difference: m(inv.total),
          evidence: [
            `Entity 1: ${peer.vendorName} · #${peer.number} (${peer.date}) · ${m(peer.total)}`,
            `Entity 2: ${inv.vendorName} · #${inv.number} (${inv.date}) · ${m(inv.total)}`,
            sameRef ? `Identical invoice number: ${inv.number}` : `Line-item keyword overlap: ${Math.round(lineOverlap * 100)}%`,
          ],
          confidence: sameRef ? "high" : "medium",
          confidenceReason: "Cross-entity graph check matched identical amounts and shared references/descriptions across two vendor profiles.",
          uncertainty: "Two independent suppliers can occasionally charge an identical flat fee for similar work.",
          recommendedAction: "Confirm whether both vendor names belong to the same supplier group before paying both invoices.",
          amountAtRisk: str2(myTotal),
        })
      );
      break;
    }
  }

  return out;
}
