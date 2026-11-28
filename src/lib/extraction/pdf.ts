import { groupIntoLines, pdfLinesToText } from "./pdf-layout";

export class NoTextLayerError extends Error {}
export class PdfPageLimitError extends Error {}
const MAX_PDF_PAGES = 5;

/**
 * Reads the text layer of a PDF entirely in the browser (pdf.js, same-origin worker). Nothing is uploaded.
 * Returns text in the form `parseText` understands. Scanned PDFs have no text layer and throw NoTextLayerError.
 */
export async function pdfToText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  // pdf.js hands the bytes to its worker, which takes ownership. Give it a copy so the caller's buffer survives for scan recovery.
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), useSystemFonts: false });
  const doc = await task.promise;
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new PdfPageLimitError(`This PDF has more than ${MAX_PDF_PAGES} pages. Export it as a CSV or paste the invoice text so no line items are missed.`);
    const lines: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.flatMap((i) => ("str" in i ? [{ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }] : []));
      lines.push(...groupIntoLines(items));
    }
    if (lines.join("").replace(/\s/g, "").length < 20) throw new NoTextLayerError("This PDF has no selectable text (it looks like a scan).");
    return pdfLinesToText(lines);
  } finally {
    void task.destroy();
  }
}

/** Largest canvas drawn for OCR: enough detail to read a page, small enough that no page can exhaust browser memory. */
const MAX_CANVAS_SIDE = 4096;
const MAX_CANVAS_PIXELS = 16_000_000;

/** Draws the pages of a PDF to images so a scan can be read by OCR. Every permitted page is drawn, so a total on a later page is not missed. */
export async function pdfToImages(data: ArrayBuffer, maxPages = MAX_PDF_PAGES): Promise<Blob[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), useSystemFonts: false });
  const doc = await task.promise;
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new PdfPageLimitError(`This PDF has more than ${MAX_PDF_PAGES} pages. Export it as a CSV or paste the invoice text so no line items are missed.`);
    const out: Blob[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, MAX_CANVAS_SIDE / Math.max(base.width, base.height), Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      out.push(await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't render the page."))), "image/png")));
    }
    return out;
  } finally {
    void task.destroy();
  }
}
