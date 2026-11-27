import type { AuditFinding, Invoice, RuleId } from "./types";
import { RULE_META } from "./audit/engine";

/**
 * Presentation-only helpers. They never change what the audit rules find: they explain, for one finding, what was
 * checked, which figures were compared, where each figure came from, and what to confirm on the original bill.
 */

export type ExtractionKind = "simulated" | "csv" | "text" | "pdf" | "sample" | "unknown";

export interface ExtractionInfo {
  kind: ExtractionKind;
  /** Short label for chips and table cells. */
  short: string;
  /** One-line headline. */
  label: string;
  /** What this means for how far the figures can be trusted. */
  detail: string;
  /** False when the figures are not taken from a document the user supplied. */
  fromYourDocument: boolean;
}

/** How the invoice's figures were obtained. Photos and scans are never read, so they can only ever be "simulated". */
export function extractionInfo(inv: Pick<Invoice, "extraction" | "source">): ExtractionInfo {
  switch (inv.extraction) {
    case "mock":
      return { kind: "simulated", short: "simulated, not from your file", label: "Simulated example, not your document",
        detail: "The uploaded file was never read. Overbill cannot read photos, scans or image files. These figures are a scripted demo example chosen from the file name, so nothing here says anything about your real bill.", fromYourDocument: false };
    case "csv":
      return { kind: "csv", short: "from your CSV", label: "Read from your CSV file",
        detail: "Each figure is a value from a row or cell in your file. Nothing was guessed, but a wrong column mapping or a missing row would still change the result.", fromYourDocument: true };
    case "text":
      return { kind: "text", short: "from your pasted text", label: "Read from the text you pasted",
        detail: "Figures were picked out of the text by pattern matching. Line items, totals or dates can be paired up wrongly, so check them against the bill.", fromYourDocument: true };
    case "pdf":
      return { kind: "pdf", short: "from the PDF's text", label: "Read from the PDF's embedded text",
        detail: "Overbill took the text stored inside the PDF. It did not look at the page image and used no optical character recognition. Columns can be scrambled in the stored text, so check line items against the printed bill.", fromYourDocument: true };
    default:
      return inv.source === "demo"
        ? { kind: "sample", short: "sample data", label: "Fictional sample data",
          detail: "This invoice ships with Overbill as an example. It is not a real bill.", fromYourDocument: false }
        : { kind: "unknown", short: "source not recorded", label: "Source of these figures was not recorded",
          detail: "This invoice was saved before Overbill recorded how figures were read. Check every figure against the original bill.", fromYourDocument: true };
  }
}

/** Invoices whose figures are invented (simulated extraction). Their findings must never count toward real totals. */
export const isSimulated = (inv: Pick<Invoice, "extraction">) => inv.extraction === "mock";

const FIELD_LABEL: Record<string, string> = {
  vendorName: "vendor name", number: "invoice number", date: "invoice date", dueDate: "due date", currency: "currency", total: "total",
};
export const uncertainFieldLabels = (inv: Pick<Invoice, "uncertainFields">) => (inv.uncertainFields ?? []).map((k) => FIELD_LABEL[k] ?? k);

export interface EvidenceRow { label: string; value: string; from: string }

export interface FindingGuide {
  /** Plain-language statement of the rule that ran. */
  checked: string;
  ruleName: string;
  /** The figures compared, each with where it came from. */
  compared: EvidenceRow[];
  /** What to confirm on the original bill, in order. */
  verify: string[];
  /** Extra caveats about the reading of this invoice (separate from the finding's own uncertainty). */
  readingNotes: string[];
}

type Kind = { checked: string; expectedFrom: string; actualFrom: string; verify: string[] };

function kindFor(f: AuditFinding, inv: Invoice): Kind {
  const key = f.id.slice(f.id.indexOf(`:${f.ruleId}`) + f.ruleId.length + 1).replace(/^:/, "");
  const lineNo = inv.lineItems.findIndex((l) => f.evidence[0]?.includes(`"${l.description}"`)) + 1;
  const where = lineNo > 0 ? `line ${lineNo} (“${inv.lineItems[lineNo - 1].description}”)` : "the line";
  const items = inv.lineItems.filter((l) => l.kind === "item").length;
  const fees = inv.lineItems.filter((l) => l.kind === "fee").length;

  switch (f.ruleId as RuleId) {
    case "arithmetic":
      if (key.startsWith("line-")) return {
        checked: `Whether quantity × unit price equals the printed total on ${where}.`,
        expectedFrom: "Overbill recalculated quantity × unit price from the figures on that line",
        actualFrom: "Line total printed on the invoice",
        verify: [`Find ${where} on the bill and read the quantity, unit price and line total.`, "Check for a minimum charge, rounding rule or discount noted next to the line.", "If the bill matches these figures, the vendor's arithmetic is wrong. If it doesn't, the reading is wrong: correct the invoice."] };
      if (key === "subtotal") return {
        checked: `Whether the subtotal equals the sum of the ${items} item line${items === 1 ? "" : "s"}.`,
        expectedFrom: `Overbill added up the ${items} item line${items === 1 ? "" : "s"} it read`,
        actualFrom: "Subtotal printed on the invoice",
        verify: ["Add up the item lines on the printed bill yourself.", "Look for lines Overbill may have missed, such as a second page or a continued table.", "Check whether the subtotal is meant to include anything that isn't an item line."] };
      if (key === "fees") return {
        checked: `Whether the fees total equals the sum of the ${fees} fee line${fees === 1 ? "" : "s"}.`,
        expectedFrom: `Overbill added up the ${fees} fee line${fees === 1 ? "" : "s"} it read`,
        actualFrom: "Fees total printed on the invoice",
        verify: ["List every fee on the printed bill and add them up.", "Check whether a fee is printed outside the itemised lines (for example in a footnote)."] };
      return {
        checked: "Whether subtotal − discounts + tax + fees equals the printed total.",
        expectedFrom: "Overbill recalculated the total from the subtotal, discounts, tax and fees it read",
        actualFrom: "Total printed on the invoice",
        verify: ["Read the subtotal, discounts, tax, fees and total off the bill, and do the sum.", "Look for a carried-over balance, credit or rounding line that wasn't captured.", "Check the total you are asked to pay, not just the total of this invoice's lines."] };
    case "tax":
      if (key === "rate-change") return {
        checked: "Whether the tax rate matches the rate on this vendor's previous invoice.",
        expectedFrom: "Tax rate on the vendor's previous invoice stored in Overbill",
        actualFrom: "Tax rate on this invoice",
        verify: ["Find the tax rate or VAT line on the bill.", "Check whether the service type, your location or the law changed the rate."] };
      return {
        checked: "Whether the tax amount equals the stated rate applied to the taxable amount.",
        expectedFrom: "Overbill applied the stated tax rate to the taxable amount it read",
        actualFrom: "Tax amount printed on the invoice",
        verify: ["Find the tax rate(s) and tax amount on the bill.", "Check whether any line is tax-exempt or reverse-charged, which would change the tax legitimately.", "Check which amount the rate is applied to (before or after discounts)."] };
    case "duplicate_invoice":
      return {
        checked: "Whether another invoice from this vendor has the same number, total or date.",
        expectedFrom: "Your other invoices from this vendor stored in Overbill",
        actualFrom: "Invoice number, date and total on this invoice",
        verify: ["Open both invoices side by side and compare number, date, total and the service period they cover.", "Check the purchase order or reference number if there is one.", "Check your payment records so you don't pay both."] };
    case "duplicate_line":
      return {
        checked: "Whether the same line (description, quantity and price) appears more than once.",
        expectedFrom: "One line per charge on this invoice",
        actualFrom: "The repeated lines Overbill read from this invoice",
        verify: ["Find each repeated line on the bill and check it really appears more than once.", "Check whether the repeats cover different periods, sites or users."] };
    case "dates":
      if (key === "terms-change") return {
        checked: "Whether the gap between invoice date and due date matches this vendor's usual payment terms.",
        expectedFrom: "Typical terms across this vendor's earlier invoices stored in Overbill",
        actualFrom: "Invoice date and due date on this invoice",
        verify: ["Read the invoice date and the due date or payment terms printed on the bill.", "Check your contract for the agreed payment terms."] };
      return {
        checked: "Whether the invoice and due dates are valid and in a sensible order.",
        expectedFrom: "A valid date in a sensible order",
        actualFrom: "Dates on this invoice",
        verify: ["Read the invoice date and due date on the bill, paying attention to the year and the day/month order.", "Correct the invoice if the dates were read wrongly."] };
    case "price_history":
      return {
        checked: "Whether this invoice's net amount is higher than this vendor's usual amount.",
        expectedFrom: "Baseline from this vendor's earlier invoices stored in Overbill",
        actualFrom: "Net amount (subtotal − discounts) of this invoice",
        verify: ["Check the bill for a plan change, extra seats or usage, or a price-change notice.", "Compare the line items with the previous invoice to find what changed.", "Check whether your contract allows indexation or price rises."] };
    case "contract_rate":
      return {
        checked: "Whether a price or total is above a rate or expected amount that you entered.",
        expectedFrom: "Rate or expected amount you entered in Overbill",
        actualFrom: "Unit price or total on this invoice",
        verify: ["Check the rate you entered against your contract or quote: is it current?", "Check the bill's line price and quantity.", "Check whether a different tier or newer agreement applies."] };
    case "unexpected_fee":
      return {
        checked: "Whether this fee line appeared on this vendor's earlier invoices.",
        expectedFrom: "This vendor's earlier invoices stored in Overbill (no such fee)",
        actualFrom: "Fee line on this invoice",
        verify: ["Find the fee on the bill and read what it says it covers.", "Check your agreement and any notices for permission to charge it.", "Check whether you asked for a service that explains it."] };
    default:
      return { checked: f.title, expectedFrom: "Overbill's calculation", actualFrom: "This invoice", verify: ["Compare the figures with the original bill."] };
  }
}

export function findingGuide(f: AuditFinding, inv: Invoice): FindingGuide {
  const k = kindFor(f, inv);
  const info = extractionInfo(inv);
  const meta = RULE_META.find((r) => r.id === f.ruleId);
  const readingNotes: string[] = [];
  if (!info.fromYourDocument && info.kind === "simulated") readingNotes.push(info.detail);
  else if (info.kind !== "sample") readingNotes.push(info.detail);
  const unc = uncertainFieldLabels(inv);
  if (unc.length) readingNotes.push(`Overbill was unsure about the ${unc.join(", ")} and you confirmed ${unc.length === 1 ? "it" : "them"} before the check ran. If you confirmed from memory, re-check.`);

  const compared: EvidenceRow[] = [
    { label: "Expected", value: f.expected, from: k.expectedFrom },
    { label: "Invoice says", value: f.actual, from: `${k.actualFrom} (${info.short})` },
    { label: "Difference", value: f.difference, from: "Invoice figure minus expected figure" },
  ];
  const verify = info.kind === "simulated"
    ? ["Do not use this result. Upload a CSV, paste the invoice text, or use a PDF that has selectable text to run a real check."]
    : [...(info.kind === "pdf" || info.kind === "text" ? ["Confirm that the figures in “Invoice says” match what is printed on your bill."] : []), ...k.verify];
  return { checked: k.checked, ruleName: meta?.name ?? f.ruleId, compared, verify, readingNotes };
}
