import { pdfLinesToText } from "./pdf-layout";
import { keepCreditSignal } from "./credit";
import { cleanOcrLines, diagnoseOcr, scoreOcr } from "./ocr-clean";
import { prepareImage } from "./image-prep";

export class OcrError extends Error {}

const GOOD_ENOUGH = 60;

/**
 * Reads text from a photo or scan with Tesseract, entirely in the browser. The OCR engine and English language data are
 * served from this site (public/ocr), so nothing is downloaded from, or sent to, anyone else.
 *
 * Each page is cleaned up first (orientation, size, contrast, shadows), then read in more than one way. The best-scoring
 * read wins; a sideways or upside-down page is tried in every orientation. Look-alike characters inside amounts
 * (O/0, l/1, S/5, B/8) are repaired. Results are still less reliable than a text PDF, so callers send them to confirmation.
 */
export async function ocrToText(images: Blob[]): Promise<string> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    gzip: true,
    workerBlobURL: false, // a same-origin script, not a blob:, so the security policy can stay strict
  }).catch((e: unknown) => { console.error("OCR start failed", e); throw new OcrError("The text reader couldn't start in this browser (it may be low on memory). Close other tabs and try again, or use a PDF with selectable text, a CSV, or paste the text."); });

  const read = async (img: Blob, psm: string) => {
    await worker.setParameters({ tessedit_pageseg_mode: psm as never, preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(img);
    return data.text;
  };

  try {
    const pages: string[] = [];
    let dims: { width: number; height: number; contrast: number } | undefined;
    for (const original of images) {
      let best = { text: "", score: -1 };
      const consider = (text: string) => { const score = scoreOcr(text); if (score > best.score) best = { text, score }; };
      let variants = await prepareImage(original, 0).catch(() => null);
      if (!variants) { consider(await read(original, PSM.AUTO)); }
      else {
        dims = { width: variants[0].width, height: variants[0].height, contrast: variants[0].contrast };
        consider(await read(variants[0].blob, PSM.SINGLE_BLOCK));
        if (best.score < GOOD_ENOUGH * 1.5) consider(await read(variants[1].blob, PSM.SINGLE_BLOCK));
        if (best.score < GOOD_ENOUGH * 1.5) consider(await read(variants[0].blob, PSM.SINGLE_COLUMN));
        // Still poor: the page may be sideways or upside down.
        if (best.score < GOOD_ENOUGH) {
          for (const turn of [90, 270, 180] as const) {
            variants = await prepareImage(original, turn).catch(() => null);
            if (!variants) continue;
            consider(await read(variants[0].blob, PSM.SINGLE_BLOCK));
            if (best.score >= GOOD_ENOUGH) break;
          }
        }
      }
      pages.push(best.text);
    }
    const lines = cleanOcrLines(pages.join("\n").split(/\r?\n/));
    const verdict = diagnoseOcr(lines.join("\n"), dims);
    if (!verdict.ok) throw new OcrError(verdict.message);
    return keepCreditSignal(lines.join("\n"), pdfLinesToText(lines));
  } finally {
    await worker.terminate();
  }
}
