/**
 * Pure helpers that make OCR output usable: repair the classic digit/letter confusions inside amounts, and score a read
 * so the best of several attempts wins. Deterministic and DOM-free, so they are unit-tested.
 */

const LOOKALIKE: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", l: "1", I: "1", "|": "1", i: "1", S: "5", s: "5", B: "8", Z: "2", z: "2", G: "6", g: "9" };
// An amount-shaped token: optional symbol, digits and look-alikes, a separator, then exactly two decimals.
const AMOUNT_TOKEN = /(?<![\p{L}\d])([€$£]?)([\dOoDQlI|iSsBZzG]{1,9}(?:[.,\s]?[\dOoDQlI|iSsBZzG]{3})*)([.,])([\dOoDQlI|iSsBZzG]{2})(?![\p{L}\d])/gu;

/** "12 .50", "12. 50" and "12 ,50" are one amount split by OCR spacing. */
const closeDecimalGaps = (s: string) => s.replace(/(\d)\s+([.,])\s*(\d{2})(?!\d)/g, "$1$2$3").replace(/(\d[.,])\s+(\d{2})(?!\d)/g, "$1$2");

export function fixAmountDigits(line: string): string {
  return closeDecimalGaps(line).replace(AMOUNT_TOKEN, (whole, sym: string, int: string, sep: string, dec: string) => {
    const digits = (int + dec).replace(/[^\d]/g, "").length;
    // Words like "SOLID" or "BOSS" never reach here (they need a decimal separator), but demand real digits as an anchor.
    if (digits < 2) return whole;
    const fix = (t: string) => t.replace(/[OoDQlI|iSsBZzG]/g, (c) => LOOKALIKE[c] ?? c);
    return `${sym}${fix(int)}${sep}${fix(dec)}`;
  });
}

/** A currency symbol OCR read as a letter: "C12.50" / "E12,50" before an amount. Only touched when it is clearly followed by an amount. */
export function fixCurrencySymbol(line: string): string {
  return line.replace(/(^|\s)[CEc](?=\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?!\d))/g, (_m, pre: string) => `${pre}€`);
}

export function cleanOcrLines(lines: string[]): string[] {
  return lines
    .map((l) => l.replace(/[   ]/g, " ").replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, "-").replace(/\t/g, "  ").trim())
    .filter(Boolean)
    .map((l) => fixCurrencySymbol(fixAmountDigits(l)));
}

const KEYWORDS = /\b(invoice|factuur|rechnung|total|totaal|subtotal|amount|due|balance|vat|btw|tax|date|datum|patient|insurance|payment|statement|account|receipt|qty|quantity|price|description|bill)\b/gi;
const AMOUNT = /\d[\d.,]*[.,]\d{2}(?!\d)/g;

/** Higher is better. Rewards recognisable amounts and invoice words, punishes symbol soup. */
export function scoreOcr(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const amounts = (t.match(AMOUNT) ?? []).length;
  const words = (t.match(KEYWORDS) ?? []).length;
  const letters = (t.match(/\p{L}/gu) ?? []).length, digits = (t.match(/\d/g) ?? []).length;
  const junk = (t.match(/[^\p{L}\d\s.,:;%€$£()\-/#@&'"+*=|]/gu) ?? []).length;
  const good = letters + digits;
  const junkRatio = junk / Math.max(1, good + junk);
  return amounts * 3 + words * 4 + Math.min(good, 1500) / 30 - junkRatio * 40;
}

export type OcrDiagnosis = { ok: boolean; message: string };

/** Says *why* a read failed, in plain words with a concrete next step, instead of a generic "couldn't read". */
export function diagnoseOcr(text: string, image?: { width: number; height: number; contrast?: number }): OcrDiagnosis {
  const amounts = (text.match(AMOUNT) ?? []).length;
  if (amounts > 0) return { ok: true, message: "" };
  const words = (text.match(/\p{L}{3,}/gu) ?? []).length;
  if (image && Math.max(image.width, image.height) < 900) return { ok: false, message: `That image is small (${image.width}×${image.height}px), so the digits are too blurry to read. Take the photo closer, or use the original PDF.` };
  if (image?.contrast !== undefined && image.contrast < 40) return { ok: false, message: "That photo is too dark or too washed out to read. Retake it in good light with the page flat, or paste the text." };
  if (words < 4) return { ok: false, message: "No text could be found in that image. Check it is the right way up, in focus and fills the frame, or paste the text instead." };
  return { ok: false, message: "Text was found but no amounts. This can happen on pages with only a cover note, so try the page with the figures on it, or paste the text. Nothing was saved." };
}
