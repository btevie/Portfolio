import type { Currency } from "../types";
import { parseCsv, parseText } from "./parsers";
import { mockExtract } from "./mock";
import { absoluteAmounts, isCreditDocument } from "./credit";
import { parseEml } from "./eml";
import { NoTextLayerError, PdfPageLimitError, pdfToImages, pdfToText } from "./pdf";
import { ocrToText } from "./ocr";
import { MAX_TEXT_CHARS, type ExtractedInvoice, type ExtractionInput } from "./types";

let seq = 0;

/** Credit notes are read like invoices with positive amounts, then flagged so they are tracked instead of audited. */
function withCredit(text: string, parse: (t: string) => ExtractedInvoice): ExtractedInvoice {
  if (!isCreditDocument(text)) return parse(text);
  return { ...parse(absoluteAmounts(text)), isCredit: true };
}

/** Text read by OCR can have a wrong digit or letter, so every field must be confirmed by the person before it is audited. */
const confirmAll = (e: ExtractedInvoice): ExtractedInvoice => ({ ...e, lowConfidence: ["vendorName", "number", "date", "dueDate", "total"] });
const IMAGE = /\.(png|jpe?g|webp)$/i;

/** Default extractor: real parsing for CSV, pasted text and PDFs with a text layer; scripted demo for photos and unreadable files. */
export async function extractInvoice(input: ExtractionInput, ctx: { defaultCurrency: Currency }): Promise<ExtractedInvoice> {
  if (input.kind === "text") {
    if (input.text.length > MAX_TEXT_CHARS) throw new Error(`Pasted text is longer than ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
    return withCredit(input.text, (t) => parseText(t, ctx.defaultCurrency));
  }
  if (input.name.toLowerCase().endsWith(".csv")) return withCredit(input.text ?? "", (t) => parseCsv(t, ctx.defaultCurrency));
  if (input.name.toLowerCase().endsWith(".eml") && input.data) {
    // A saved email: use its PDF attachment if there is one, otherwise the text of the message itself.
    const mail = parseEml(input.data);
    if (mail.pdfs[0]) return withCredit(await pdfToText(mail.pdfs[0].data), (t) => parseText(t, ctx.defaultCurrency, "pdf"));
    if (!mail.text) throw new Error("This email has no readable text or PDF attachment. Save the invoice itself, or paste its text.");
    return withCredit(mail.text.slice(0, MAX_TEXT_CHARS), (t) => parseText(t, ctx.defaultCurrency, "text"));
  }
  if (input.name.toLowerCase().endsWith(".pdf") && input.data) {
    try {
      return withCredit(await pdfToText(input.data), (t) => parseText(t, ctx.defaultCurrency, "pdf"));
    } catch (e) {
      if (e instanceof NoTextLayerError) {
        // A scan: draw the pages and read them with OCR, then insist on confirmation.
        const text = await ocrToText(await pdfToImages(input.data));
        return confirmAll(withCredit(text, (t) => parseText(t, ctx.defaultCurrency, "ocr")));
      }
      // A genuine PDF whose text can't be understood is the user's to fix. Only a file pdf.js cannot open at all falls through to the demo extractor.
      // Known limitation: an encrypted/corrupt real PDF therefore gets scripted demo figures, always labelled "Simulated".
      if (e instanceof NoTextLayerError || e instanceof PdfPageLimitError || (e instanceof Error && /No line items|Couldn't read/.test(e.message))) throw e;
    }
  }
  if (IMAGE.test(input.name) && input.data) {
    const type = /\.png$/i.test(input.name) ? "image/png" : /\.webp$/i.test(input.name) ? "image/webp" : "image/jpeg";
    const text = await ocrToText([new Blob([input.data], { type })]);
    return confirmAll(withCredit(text, (t) => parseText(t, ctx.defaultCurrency, "ocr")));
  }
  return mockExtract(input.name, ++seq + (Date.now() % 9000));
}

export type { ExtractedInvoice } from "./types";
