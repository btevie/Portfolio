const COMPANY_SUFFIX = /\b(inc|ltd|llc|bv|gmbh|co|corp|corporation|limited|plc|sa|ag)\b/g;

export function normalizeVendor(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, " ")
    .replace(COMPANY_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** "INV-0042", "inv 42", "#0042" and "Invoice No. 42" all normalise to "42". */
export function normalizeInvoiceNumber(n: string): string {
  const s = n.toLowerCase().replace(/invoice|inv|no\.?|number|#/g, "").replace(/[^a-z0-9]/g, "");
  const stripped = s.replace(/^0+(?=\d)/, "");
  return stripped;
}

export function normalizeDescription(d: string): string {
  return d.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
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
