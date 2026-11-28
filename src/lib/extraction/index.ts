import type { Currency } from "../types";
import { parseCsv, parseText } from "./parsers";
import { mockExtract } from "./mock";
import { absoluteAmounts, isCreditDocument } from "./credit";
import { parseEml } from "./eml";
import { pdfLinesToText } from "./pdf-layout";
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
const confirmAll = (e: ExtractedInvoice): ExtractedInvoice => ({ ...e, lowConfidence: [...new Set([...(e.lowConfidence ?? []), "vendorName", "number", "date", "dueDate", "total"])] as ExtractedInvoice["lowConfidence"] });
const IMAGE = /\.(png|jpe?g|webp)$/i;

/** A PDF with a text layer is read directly; a scan is drawn and read with OCR, then every field must be confirmed. */
async function extractPdf(data: ArrayBuffer, cur: Currency): Promise<ExtractedInvoice> {
  try {
    return withCredit(await pdfToText(data), (t) => parseText(t, cur, "pdf"));
  } catch (e) {
    if (!(e instanceof NoTextLayerError)) throw e;
    const text = await ocrToText(await pdfToImages(data));
    return confirmAll(withCredit(text, (t) => parseText(t, cur, "ocr")));
  }
}

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
    if (mail.pdfs[0]) return extractPdf(mail.pdfs[0].data, ctx.defaultCurrency);
    if (!mail.text) throw new Error("This email has no readable text or PDF attachment. Save the invoice itself, or paste its text.");
    const body = mail.text.slice(0, MAX_TEXT_CHARS);
    try {
      return withCredit(body, (t) => parseText(t, ctx.defaultCurrency, "text"));
    } catch (e) {
      // Email tables arrive as whitespace-separated rows, not "a | b | c": reshape them the way PDF text is, then try again.
      if (!(e instanceof Error) || !/No line items/.test(e.message)) throw e;
      // The reshaping drops a "Credit invoice" heading, so decide from the original body and keep the credit classification.
      const reshaped = pdfLinesToText(body.split("\n"));
      if (isCreditDocument(body)) return { ...parseText(absoluteAmounts(reshaped), ctx.defaultCurrency, "text"), isCredit: true };
      return withCredit(reshaped, (t) => parseText(t, ctx.defaultCurrency, "text"));
    }
  }
  if (input.name.toLowerCase().endsWith(".pdf") && input.data) {
    let text: string | null = null;
    try {
      text = await pdfToText(input.data);
    } catch (e) {
      if (e instanceof NoTextLayerError) {
        // A scan: draw the pages and read them with OCR, then insist on confirmation.
        const scanned = await ocrToText(await pdfToImages(input.data));
        return confirmAll(withCredit(scanned, (t) => parseText(t, ctx.defaultCurrency, "ocr")));
      }
      // Known limitation: a PDF pdf.js cannot open at all (encrypted/corrupt) gets scripted demo figures, always labelled "Simulated".
      if (e instanceof PdfPageLimitError) throw e;
    }
    // The file opened: anything wrong with its contents is the user's to fix, so it must never be replaced by demo data.
    if (text !== null) return withCredit(text, (t) => parseText(t, ctx.defaultCurrency, "pdf"));
  }
  if (IMAGE.test(input.name) && input.data) {
    const type = /\.png$/i.test(input.name) ? "image/png" : /\.webp$/i.test(input.name) ? "image/webp" : "image/jpeg";
    const text = await ocrToText([new Blob([input.data], { type })]);
    return confirmAll(withCredit(text, (t) => parseText(t, ctx.defaultCurrency, "ocr")));
  }
  return mockExtract(input.name, ++seq + (Date.now() % 9000));
}

export type { ExtractedInvoice } from "./types";
