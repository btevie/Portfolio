import type { Currency } from "../types";
import { parseCsv, parseText } from "./parsers";
import { mockExtract } from "./mock";
import { MAX_TEXT_CHARS, type ExtractedInvoice, type ExtractionInput } from "./types";

let seq = 0;

/** Default extractor: real parsing for CSV/pasted text, scripted mock for PDF/images. */
export async function extractInvoice(input: ExtractionInput, ctx: { defaultCurrency: Currency }): Promise<ExtractedInvoice> {
  if (input.kind === "text") {
    if (input.text.length > MAX_TEXT_CHARS) throw new Error(`Pasted text is longer than ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
    return parseText(input.text, ctx.defaultCurrency);
  }
  if (input.name.toLowerCase().endsWith(".csv")) return parseCsv(input.text ?? "", ctx.defaultCurrency);
  return mockExtract(input.name, ++seq + (Date.now() % 9000));
}

export type { ExtractedInvoice } from "./types";
