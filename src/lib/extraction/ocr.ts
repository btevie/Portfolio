import { pdfLinesToText } from "./pdf-layout";

export class OcrError extends Error {}

/**
 * Reads text from a photo or scan with Tesseract, entirely in the browser. The OCR engine and English language data are
 * served from this site (public/ocr), so nothing is downloaded from, or sent to, anyone else.
 * Results are less reliable than text PDFs, so callers must send them through the confirmation screen.
 */
export async function ocrToText(images: Blob[]): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    gzip: true,
    workerBlobURL: false, // a same-origin script, not a blob:, so the security policy can stay strict
  }).catch((e: unknown) => { console.error("OCR start failed", e); throw new OcrError("The text reader couldn't start in this browser. Export the invoice as a PDF with selectable text, a CSV, or paste its text."); });
  try {
    const lines: string[] = [];
    for (const img of images) {
      const { data } = await worker.recognize(img);
      lines.push(...data.text.split(/\r?\n/));
    }
    const text = pdfLinesToText(lines);
    if (!/\|/.test(text)) throw new OcrError("Couldn't find any line items in that image. Try a sharper, straight-on photo, or paste the invoice text instead.");
    return text;
  } finally {
    await worker.terminate();
  }
}
