const COMPANY_SUFFIX = /\b(inc|ltd|llc|bv|gmbh|co|corp|corporation|limited|plc|sa|ag)\b/g;
const NON_ALNUM = /[^\p{L}\p{N}]+/gu;

/**
 * Identity keys must never collapse to an empty string: two unrelated vendors (or invoice numbers)
 * written in a non-Latin script would otherwise share a key and be merged or flagged as duplicates.
 * Unicode letters and digits are kept; if nothing survives, the trimmed, case-folded original is used.
 */
const keyOr = (key: string, original: string) => key || original.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

export function normalizeVendor(name: string): string {
  const key = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, " ")
    .replace(COMPANY_SUFFIX, " ")
    .replace(NON_ALNUM, " ")
    .trim()
    .replace(/\s+/g, " ");
  return keyOr(key, name);
}

/** "INV-0042", "inv 42", "#0042" and "Invoice No. 42" all normalise to "42". */
export function normalizeInvoiceNumber(n: string): string {
  const source = n.normalize("NFKC").trim().toLowerCase();
  if (/^(?:[-–—]+|n\s*\/\s*a|none|null|unknown|not\s+available|not\s+applicable)$/i.test(source)) return "";
  // Strip common printed labels only at the start. Removing these strings
  // globally could collapse real identifiers such as "INVEST-42" and "EST-42".
  const withoutLabel = source.replace(/^(?:(?:invoice|inv)(?=\b|\d|[:#.-])(?:\s*(?:no\.?|number))?|no\.?(?=\s|\d|[:#.-])|number(?=\s|\d|[:#.-]))\s*[:#.-]?\s*/, "");
  const s = withoutLabel.replace(/^#+/, "").replace(NON_ALNUM, "");
  return keyOr(s.replace(/^0+(?=\d)/, ""), n);
}

export function normalizeDescription(d: string): string {
  const key = d.normalize("NFKC").toLowerCase().replace(NON_ALNUM, " ").replace(/\s+/g, " ").trim();
  return keyOr(key, d);
}

// ---- dates (UTC, ISO only) ----
export function parseISO(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

export const DAY = 86_400_000;
export const daysBetween = (a: number, b: number): number => Math.round((b - a) / DAY);

export function subtractMonths(t: number, months: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate());
}
