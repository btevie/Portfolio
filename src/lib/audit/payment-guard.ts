import type { AuditFinding, Invoice } from "../types";
import { priorInvoices } from "./history";
import { D, formatMoney, str2 } from "./money";
import type { AuditContext } from "./types";
import { makeFinding } from "./rules/util";

const IBAN_RX = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?)\b/g;

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** ISO 13616 Mod-97 IBAN mathematical checksum verification. */
export function isValidIbanMod97(iban: string): boolean {
  const clean = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  let numeric = "";
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    numeric += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  let rem = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    rem = Number(String(rem) + numeric.slice(i, i + 7)) % 97;
  }
  return rem === 1;
}

export function extractIbans(inv: Invoice): string[] {
  const blob = [inv.number, ...inv.lineItems.map((l) => l.description)].join(" \n ").toUpperCase();
  const found = new Set<string>();
  for (const m of blob.matchAll(IBAN_RX)) {
    const clean = normalizeIban(m[1]);
    if (clean.length >= 15 && clean.length <= 34) found.add(clean);
  }
  return [...found];
}

export function paymentGuardFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  const out: AuditFinding[] = [];
  const currentIbans = extractIbans(inv);
  if (currentIbans.length === 0) return out;

  const m = (v: string) => formatMoney(v, inv.currency);

  // 1. Check ISO 13616 Mod-97 mathematical checksum on every detected IBAN
  for (const iban of currentIbans) {
    if (!isValidIbanMod97(iban)) {
      out.push(
        makeFinding(inv, {
          ruleId: "unexpected_fee",
          key: `iban-mod97-${iban}`,
          classification: "LIKELY_ERROR",
          severity: "high",
          title: `Invalid IBAN checksum (${iban})`,
          explanation: `The IBAN "${iban}" printed on this invoice fails the ISO 13616 Mod-97 mathematical check-digit test, indicating a typo or tampered payment instruction.`,
          expected: "Valid ISO 13616 Mod-97 IBAN",
          actual: iban,
          difference: "Failed Mod-97 checksum",
          evidence: [`Detected IBAN: ${iban}`, "Check digits do not satisfy mod 97 = 1"],
          confidence: "high",
          confidenceReason: "Deterministic ISO 13616 Mod-97 checksum verification.",
          uncertainty: "Verify that OCR or text copy did not misread a character (such as O vs 0 or I vs 1).",
          recommendedAction: "Do not transfer funds to this IBAN until you confirm the exact account number on the original document or with the vendor.",
          amountAtRisk: str2(D(inv.total)),
        })
      );
    }
  }

  // 2. Vendor Bank-Account Swap (Business Email Compromise / Invoice Hijacking) check
  const prior = priorInvoices(inv, ctx);
  const historicalIbans = new Set<string>();
  for (const p of prior) {
    for (const oldIban of extractIbans(p)) {
      if (isValidIbanMod97(oldIban)) historicalIbans.add(oldIban);
    }
  }

  if (historicalIbans.size > 0) {
    for (const iban of currentIbans) {
      if (isValidIbanMod97(iban) && !historicalIbans.has(iban)) {
        const knownList = [...historicalIbans].join(", ");
        out.push(
          makeFinding(inv, {
            ruleId: "unexpected_fee",
            key: `iban-swap-${iban}`,
            classification: "LIKELY_ERROR",
            severity: "high",
            title: `Bank account (IBAN) changed for ${inv.vendorName} — verify before paying`,
            explanation: `This invoice lists IBAN ${iban}, whereas earlier bills from ${inv.vendorName} used ${knownList}. Sudden IBAN changes are a primary indicator of invoice-hijacking fraud (Business Email Compromise).`,
            expected: knownList,
            actual: iban,
            difference: m(inv.total),
            evidence: [
              `Previous verified IBAN(s) for ${inv.vendorName}: ${knownList}`,
              `New IBAN on invoice ${inv.number}: ${iban}`,
            ],
            confidence: "high",
            confidenceReason: "Direct comparison against historical IBANs recorded for this vendor.",
            uncertainty: "Vendors occasionally switch banks or use a factoring/escrow account.",
            recommendedAction: "Call the vendor using a known phone number (not the number on this PDF) to confirm the bank change before paying.",
            amountAtRisk: str2(D(inv.total)),
          })
        );
      }
    }
  }

  return out;
}
