import { detectDelimiter, splitCsv } from "./parsers";

/**
 * Lets a CSV with other column names (qty, price, supplier...) be read. Nothing is guessed silently: a header that is
 * not one of Overbill's own names is only used after the user confirms the mapping, and a confirmed mapping is
 * remembered for files with the same headers. Only header names are remembered, never any invoice data.
 */
export interface CsvField { key: string; label: string; required?: boolean; aliases: string[] }

export const CSV_FIELDS: CsvField[] = [
  { key: "description", label: "Description", required: true, aliases: ["description", "item", "item_description", "product", "service", "details", "line_item", "memo"] },
  { key: "quantity", label: "Quantity", required: true, aliases: ["quantity", "qty", "units", "count", "hours"] },
  { key: "unit_price", label: "Unit price", required: true, aliases: ["unit_price", "price", "rate", "unit_cost", "cost", "price_each", "unit_amount"] },
  { key: "line_total", label: "Line total", aliases: ["line_total", "total_line", "amount", "line_amount", "extended", "ext_price", "net_amount"] },
  { key: "kind", label: "Item or fee", aliases: ["kind", "type", "line_type"] },
  { key: "vendor", label: "Vendor", aliases: ["vendor", "supplier", "seller", "payee", "company"] },
  { key: "invoice_number", label: "Invoice number", aliases: ["invoice_number", "invoice_no", "invoice", "inv_no", "number", "reference", "doc_no"] },
  { key: "invoice_date", label: "Invoice date", aliases: ["invoice_date", "date", "issue_date", "issued", "bill_date"] },
  { key: "due_date", label: "Due date", aliases: ["due_date", "due", "payment_due", "due_on"] },
  { key: "currency", label: "Currency", aliases: ["currency", "ccy", "cur"] },
  { key: "tax_rate", label: "Tax rate", aliases: ["tax_rate", "vat_rate", "gst_rate"] },
  { key: "tax", label: "Tax amount", aliases: ["tax", "tax_amount", "vat_amount", "vat"] },
  { key: "discounts", label: "Discounts", aliases: ["discounts", "discount"] },
  { key: "subtotal", label: "Subtotal", aliases: ["subtotal", "sub_total", "net_total"] },
  { key: "invoice_total", label: "Invoice total", aliases: ["invoice_total", "total", "grand_total", "amount_due", "total_due"] },
];

export const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Field key -> index of the source column (or null when nothing maps to it). */
export type CsvMap = Record<string, number | null>;

export interface CsvAnalysis {
  /** ready: use `text` as is. confirm: show the mapping to the user first. */
  status: "ready" | "confirm";
  headers: string[];
  /** First few data rows, so the user can see what each column holds. */
  sample: string[][];
  map: CsvMap;
  /** Why confirmation is needed, or "remembered" / "exact" when it is not. */
  basis: "exact" | "remembered" | "guessed";
  signature: string;
  /** The original text. */
  text: string;
}

const KEY = "overbill:csv-maps";
const readSaved = (): Record<string, Record<string, string>> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; } };

export function rememberMapping(a: Pick<CsvAnalysis, "signature" | "headers">, map: CsvMap) {
  try {
    const byName: Record<string, string> = {};
    for (const [k, i] of Object.entries(map)) if (i !== null && a.headers[i] !== undefined) byName[k] = norm(a.headers[i]);
    const all = readSaved();
    const keys = Object.keys(all);
    if (keys.length >= 30 && !(a.signature in all)) delete all[keys[0]];
    all[a.signature] = byName;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the mapping just is not remembered */ }
}

export function analyzeCsv(text: string): CsvAnalysis {
  const content = text.replace(/^﻿/, "");
  const rows = splitCsv(content, detectDelimiter(content)).filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const heads = headers.map(norm);
  const signature = [...heads].sort().join("|");
  const base = { headers, sample: rows.slice(1, 4), signature, text };
  const exact: CsvMap = {};
  const used = new Set<number>();
  for (const f of CSV_FIELDS) { const i = heads.indexOf(f.key); if (i >= 0 && !used.has(i)) { exact[f.key] = i; used.add(i); } else exact[f.key] = null; }
  const requiredOk = (m: CsvMap) => CSV_FIELDS.filter((f) => f.required).every((f) => m[f.key] !== null);
  if (rows.length < 2 || (requiredOk(exact) && CSV_FIELDS.every((f) => exact[f.key] !== null || !heads.some((h, i) => !used.has(i) && f.aliases.includes(h))))) {
    return { ...base, status: "ready", map: exact, basis: "exact" };
  }
  const saved = readSaved()[signature];
  if (saved) {
    const m: CsvMap = {};
    for (const f of CSV_FIELDS) { const name = saved[f.key]; const i = name === undefined ? -1 : heads.indexOf(name); m[f.key] = i >= 0 ? i : null; }
    if (requiredOk(m)) return { ...base, status: "ready", map: m, basis: "remembered", text: applyCsvMapping(text, headers, rows, m) };
  }
  const guess: CsvMap = {};
  const taken = new Set<number>();
  for (const f of CSV_FIELDS) {
    const i = heads.findIndex((h, n) => !taken.has(n) && f.aliases.includes(h));
    guess[f.key] = i >= 0 ? i : null;
    if (i >= 0) taken.add(i);
  }
  return { ...base, status: "confirm", map: guess, basis: "guessed" };
}

const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Rewrites the file with Overbill's own header names, keeping only the mapped columns. */
export function applyCsvMapping(_text: string, _headers: string[], rows: string[][], map: CsvMap): string {
  const cols = CSV_FIELDS.filter((f) => map[f.key] !== null && map[f.key] !== undefined);
  const out = [cols.map((f) => f.key).join(",")];
  for (const r of rows.slice(1)) out.push(cols.map((f) => quote((r[map[f.key] as number] ?? "").trim())).join(","));
  return out.join("\n");
}

export function mappedText(a: CsvAnalysis, map: CsvMap): string {
  const content = a.text.replace(/^﻿/, "");
  const rows = splitCsv(content, detectDelimiter(content)).filter((r) => r.some((c) => c.trim() !== ""));
  return applyCsvMapping(a.text, a.headers, rows, map);
}

export const missingRequired = (map: CsvMap) => CSV_FIELDS.filter((f) => f.required && (map[f.key] === null || map[f.key] === undefined)).map((f) => f.label);
