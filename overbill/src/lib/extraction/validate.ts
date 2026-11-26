import { ACCEPTED_EXT, MAX_FILE_BYTES } from "./types";

const MIME_OK: Record<string, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  csv: ["text/csv", "application/vnd.ms-excel", "text/plain", ""],
};

export function validateFile(f: { name: string; type: string; size: number }): string | null {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(ACCEPTED_EXT as readonly string[]).includes(ext)) return `"${f.name}" isn't supported. Upload a PDF, PNG, JPG, WebP or CSV.`;
  if (f.size === 0) return `"${f.name}" is empty.`;
  if (f.size > MAX_FILE_BYTES) return `"${f.name}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  if (!MIME_OK[ext].includes(f.type)) return `"${f.name}" doesn't look like a real .${ext} file (type: ${f.type || "unknown"}).`;
  return null;
}
