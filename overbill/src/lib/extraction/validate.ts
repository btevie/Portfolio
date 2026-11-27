import { ACCEPTED_EXT, MAX_FILE_BYTES, MOCK_EXTRACTION_ENABLED } from "./types";

const MIME_OK: Record<string, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  csv: ["text/csv", "application/vnd.ms-excel", "text/plain", ""],
};

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** First-pass checks on what the browser reports. The extension and MIME type are claims, not proof: see `sniffFile`. */
export function validateFile(f: { name: string; type: string; size: number }, opts: { mock?: boolean } = {}): string | null {
  const ext = extOf(f.name);
  if (!(ACCEPTED_EXT as readonly string[]).includes(ext)) return `"${f.name}" isn't supported. Upload a PDF, PNG, JPG, WebP or CSV.`;
  if (f.size === 0) return `"${f.name}" is empty.`;
  if (f.size > MAX_FILE_BYTES) return `"${f.name}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  if (!MIME_OK[ext].includes(f.type)) return `"${f.name}" doesn't look like a real .${ext} file (type: ${f.type || "unknown"}).`;
  if (ext !== "csv" && !(opts.mock ?? MOCK_EXTRACTION_ENABLED)) return `Reading PDFs and images isn't available in this build. Export the invoice as a CSV or paste its text instead.`;
  return null;
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Checks the file's real leading bytes against its claimed type. */
export function checkSignature(name: string, head: Uint8Array): string | null {
  const ext = extOf(name);
  const bad = `"${name}" doesn't look like a real .${ext} file (its contents don't match).`;
  switch (ext) {
    case "pdf": {
      const needle = ascii("%PDF-");
      const limit = Math.min(head.length, 1024) - needle.length; // PDF allows a little junk before the header
      for (let i = 0; i <= limit; i++) if (startsWith(head, needle, i)) return null;
      return bad;
    }
    case "png": return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : bad;
    case "jpg": case "jpeg": return startsWith(head, [0xff, 0xd8, 0xff]) ? null : bad;
    case "webp": return startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8) ? null : bad;
    case "csv": return head.includes(0) ? bad : null; // text must not contain NUL bytes
    default: return bad;
  }
}

export async function sniffFile(f: File): Promise<string | null> {
  const head = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
  return checkSignature(f.name, head);
}
