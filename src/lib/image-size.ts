/** Reads an image's pixel size from its header, so a hostile image cannot make the browser decode something enormous. */
export const MAX_IMAGE_SIDE = 12_000;
export const MAX_IMAGE_PIXELS = 50_000_000;

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const tag = (b: Uint8Array, i: number, s: string) => s.split("").every((c, k) => b[i + k] === c.charCodeAt(0));

export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  // PNG: signature, then the IHDR chunk holds width and height
  if (b.length >= 24 && b[0] === 0x89 && tag(b, 1, "PNG")) return { width: u32be(b, 16), height: u32be(b, 20) };
  // JPEG: walk the markers until a "start of frame"
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + u16be(b, i + 2);
    }
    return null;
  }
  // WebP: RIFF container, lossy (VP8), lossless (VP8L) or extended (VP8X)
  if (b.length >= 30 && tag(b, 0, "RIFF") && tag(b, 8, "WEBP")) {
    if (tag(b, 12, "VP8X")) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (tag(b, 12, "VP8 ")) return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (tag(b, 12, "VP8L")) { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

export const imageSizeOk = (d: { width: number; height: number } | null) => !!d && d.width > 0 && d.height > 0 && d.width <= MAX_IMAGE_SIDE && d.height <= MAX_IMAGE_SIDE && d.width * d.height <= MAX_IMAGE_PIXELS;
