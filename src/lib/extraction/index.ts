import type { Currency } from "../types";
import { parseCsv, parseText } from "./parsers";
import { mockExtract } from "./mock";
import { absoluteAmounts, isCreditDocument } from "./credit";
import { NoTextLayerError, PdfPageLimitError, pdfToText } from "./pdf";
import { MAX_TEXT_CHARS, type ExtractedInvoice, type ExtractionInput } from "./types";

let seq = 0;

/** Credit notes are read like invoices with positive amounts, then flagged so they are tracked instead of audited. */
function withCredit(text: string, parse: (t: string) => ExtractedInvoice): ExtractedInvoice {
  if (!isCreditDocument(text)) return parse(text);
  return { ...parse(absoluteAmounts(text)), isCredit: true };
}

/** Default extractor: real parsing for CSV, pasted text and PDFs with a text layer; scripted demo for photos and unreadable files. */
export async function extractInvoice(input: ExtractionInput, ctx: { defaultCurrency: Currency }): Promise<ExtractedInvoice> {
  if (input.kind === "text") {
    if (input.text.length > MAX_TEXT_CHARS) throw new Error(`Pasted text is longer than ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
    return withCredit(input.text, (t) => parseText(t, ctx.defaultCurrency));
  }
  if (input.name.toLowerCase().endsWith(".csv")) return withCredit(input.text ?? "", (t) => parseCsv(t, ctx.defaultCurrency));
  if (input.name.toLowerCase().endsWith(".pdf") && input.data) {
    try {
      return withCredit(await pdfToText(input.data), (t) => parseText(t, ctx.defaultCurrency, "pdf"));
    } catch (e) {
      // A genuine PDF whose text can't be understood is the user's to fix. Only a file pdf.js cannot open at all falls through to the demo extractor.
      // Known limitation: an encrypted/corrupt real PDF therefore gets scripted demo figures, always labelled "Simulated".
      if (e instanceof NoTextLayerError || e instanceof PdfPageLimitError || (e instanceof Error && /No line items|Couldn't read/.test(e.message))) throw e;
    }
  }
  return mockExtract(input.name, ++seq + (Date.now() % 9000));
}

export type { ExtractedInvoice } from "./types";
