/** Browser-only image preparation for OCR: correct orientation, a sensible size, and cleaner contrast. */

export interface Prepared { blob: Blob; width: number; height: number; contrast: number; label: string }

const TARGET_LONG_SIDE = 2600;
const MIN_LONG_SIDE = 1800;
const MAX_PIXELS = 16_000_000;

async function decode(blob: Blob): Promise<ImageBitmap> {
  try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch { return await createImageBitmap(blob); }
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't prepare the image."))), "image/png"));

/** Percentile contrast stretch on a grey image; also returns how much usable contrast the photo had. */
function stretch(gray: Uint8ClampedArray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const at = (p: number) => { let n = 0; const goal = gray.length * p; for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= goal) return v; } return 255; };
  const lo = at(0.02), hi = at(0.98), span = Math.max(1, hi - lo);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.max(0, Math.min(255, ((gray[i] - lo) * 255) / span));
  return hi - lo;
}

/** Local-mean threshold (Bradley): copes with shadows and uneven phone lighting where a single cut-off fails. */
function adaptive(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) { let row = 0; for (let x = 1; x <= w; x++) { row += gray[(y - 1) * w + (x - 1)]; integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row; } }
  const r = Math.max(8, Math.round(Math.min(w, h) / 24)), out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r), y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    const n = (x1 - x0 + 1) * (y1 - y0 + 1);
    const sum = integral[(y1 + 1) * (w + 1) + x1 + 1] - integral[y0 * (w + 1) + x1 + 1] - integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
    out[y * w + x] = gray[y * w + x] * n < sum * 0.9 ? 0 : 255;
  }
  return out;
}

function draw(bmp: ImageBitmap, rotate: 0 | 90 | 180 | 270, scale: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } {
  const sw = Math.round(bmp.width * scale), sh = Math.round(bmp.height * scale);
  const swap = rotate === 90 || rotate === 270;
  const w = swap ? sh : sw, h = swap ? sw : sh;
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(w / 2, h / 2); ctx.rotate((rotate * Math.PI) / 180); ctx.drawImage(bmp, -sw / 2, -sh / 2, sw, sh);
  return { canvas, ctx, w, h };
}

/** Prepares one image into the variants worth reading: enhanced grey, and a shadow-proof black and white. */
export async function prepareImage(source: Blob, rotate: 0 | 90 | 180 | 270 = 0): Promise<Prepared[]> {
  const bmp = await decode(source);
  try {
    const long = Math.max(bmp.width, bmp.height);
    let scale = long < MIN_LONG_SIDE ? MIN_LONG_SIDE / long : long > TARGET_LONG_SIDE ? TARGET_LONG_SIDE / long : 1;
    scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height)));
    const { canvas, ctx, w, h } = draw(bmp, rotate, scale);
    const img = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (img.data[p] * 299 + img.data[p + 1] * 587 + img.data[p + 2] * 114) / 1000;
    const contrast = stretch(gray);
    const paint = (g: Uint8ClampedArray) => { for (let i = 0, p = 0; i < g.length; i++, p += 4) { img.data[p] = img.data[p + 1] = img.data[p + 2] = g[i]; img.data[p + 3] = 255; } ctx.putImageData(img, 0, 0); };
    paint(gray);
    const enhanced = await toBlob(canvas);
    paint(adaptive(gray, w, h));
    const bw = await toBlob(canvas);
    return [{ blob: enhanced, width: w, height: h, contrast, label: "enhanced" }, { blob: bw, width: w, height: h, contrast, label: "bw" }];
  } finally { bmp.close(); }
}
