import { D, isValidDecimal, round2, str2 } from "../audit/money";
import { parseISO } from "../audit/normalize";
import type { Currency } from "../types";
import type { ExtractedInvoice, FieldKey } from "./types";

type Line = ExtractedInvoice["lines"][number];

const CUR: Record<string, Currency> = { EUR: "EUR", "€": "EUR", USD: "USD", $: "USD", GBP: "GBP", "£": "GBP" };
const num = (s: string | undefined): string | undefined => {
  if (!s) return undefined;
  const c = s.replace(/[€$£\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  return isValidDecimal(c) ? c : undefined;
};
const iso = (s: string | undefined): string => {
  if (!s) return "";
  const t = s.trim();
  if (parseISO(t) !== null) return t;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  if (m) { const v = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; return parseISO(v) !== null ? v : t; }
  return t; // leave as-is: the date rule will flag it
};

function finalize(p: {
  vendorName?: string; number?: string; date?: string; dueDate?: string; currency?: string; taxRate?: string;
  lines: Line[]; subtotal?: string; discounts?: string; taxAmount?: string; total?: string; method: "csv" | "text"; defaultCurrency: Currency;
}): ExtractedInvoice {
  const items = p.lines.filter((l) => l.kind === "item");
  const feeLines = p.lines.filter((l) => l.kind === "fee");
  const sumItems = items.reduce((a, l) => a.plus(D(l.total)), D(0));
  const fees = feeLines.reduce((a, l) => a.plus(D(l.total)), D(0));
  const discounts = D(p.discounts);
  // Stated values are kept as-is. Only genuinely absent ones are derived, so a wrong stated total still gets audited.
  const subtotal = p.subtotal ?? str2(sumItems);
  const taxAmount = p.taxAmount ?? (p.taxRate ? str2(sumItems.plus(fees).minus(discounts).times(D(p.taxRate)).div(100)) : "0.00");
  const total = p.total ?? str2(D(subtotal).minus(discounts).plus(D(taxAmount)).plus(fees));
  const low: FieldKey[] = [];
  if (!p.vendorName) low.push("vendorName");
  if (!p.number) low.push("number");
  if (!p.date || parseISO(p.date) === null) low.push("date");
  if (!p.dueDate || parseISO(p.dueDate) === null) low.push("dueDate");
  if (p.total === undefined) low.push("total");
  return {
    vendorName: p.vendorName ?? "", number: p.number ?? "", date: p.date ?? "", dueDate: p.dueDate ?? "",
    currency: CUR[(p.currency ?? "").toUpperCase()] ?? p.defaultCurrency, lines: p.lines,
    subtotal, discounts: str2(discounts), fees: str2(fees), taxAmount, taxRate: p.taxRate, total, lowConfidence: low, method: p.method,
  };
}

const line = (description: string, quantity: string, unitPrice: string, total: string | undefined, kind: "item" | "fee", taxRate?: string): Line => ({
  description, quantity, unitPrice, total: total ?? str2(round2(D(quantity).times(D(unitPrice)))), kind, taxRate,
});

/** Header-based CSV. Required: description, quantity, unit_price. Optional: line_total, kind, vendor, invoice_number, invoice_date, due_date, currency, tax_rate, discounts, tax, total, subtotal. */
export function parseCsv(text: string, defaultCurrency: Currency): ExtractedInvoice {
  const rows = splitCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one line item.");
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (r: string[], ...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0 && r[i]?.trim()) return r[i].trim(); } return undefined; };
  for (const need of ["description", "quantity", "unit_price"]) if (!head.includes(need)) throw new Error(`The CSV is missing a "${need}" column.`);
  const first = (...n: string[]) => { for (const r of rows.slice(1)) { const v = col(r, ...n); if (v) return v; } return undefined; };
  const taxRate = num(first("tax_rate"));
  const lines: Line[] = rows.slice(1).map((r, i) => {
    const q = num(col(r, "quantity")), p = num(col(r, "unit_price"));
    if (!q || !p) throw new Error(`Row ${i + 2}: quantity and unit price must be numbers.`);
    const kind = col(r, "kind")?.toLowerCase() === "fee" ? "fee" : "item";
    return line(col(r, "description") ?? "Item", q, p, num(col(r, "line_total", "total_line")), kind, num(col(r, "line_tax_rate")) ?? taxRate);
  });
  return finalize({
    vendorName: first("vendor"), number: first("invoice_number"), date: iso(first("invoice_date")), dueDate: iso(first("due_date")),
    currency: first("currency"), taxRate, lines, subtotal: num(first("subtotal")), discounts: num(first("discounts")),
    taxAmount: num(first("tax")), total: num(first("invoice_total", "total")), method: "csv", defaultCurrency,
  });
}

function splitCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell); out.push(row);
  return out;
}

export const SAMPLE_TEXT = `Vendor: Brightline Telecom
Invoice #: BT-88105
Invoice date: 2026-11-25
Due date: 2026-12-09
Currency: EUR
Tax rate: 21%
Business fibre 500/500 | 1 | 49.00 | 49.00
Static IP address | 1 | 5.00 | 5.00 | fee
Subtotal: 49.00
Tax: 11.34
Total: 65.34`;

/** Key/value lines plus pipe-delimited items:  description | qty | unit price | total [| fee] */
export function parseText(text: string, defaultCurrency: Currency): ExtractedInvoice {
  const kv: Record<string, string> = {};
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.includes("|")) {
      const [d, q, p, t, k] = l.split("|").map((x) => x.trim());
      const qn = num(q), pn = num(p);
      if (!(d && qn && pn)) throw new Error(`Couldn't read the line "${l.slice(0, 60)}". Use: description | quantity | unit price | total`);
      lines.push(line(d, qn, pn, num(t), k?.toLowerCase() === "fee" ? "fee" : "item"));
      continue;
    }
    const m = /^([A-Za-z #./]+?)\s*[:=]\s*(.+)$/.exec(l);
    if (m) kv[m[1].toLowerCase().replace(/[^a-z]/g, "")] = m[2].trim();
  }
  const rate = kv["taxrate"] ?? kv["vatrate"] ?? kv["vat"];
  const taxRate = num(rate?.replace("%", ""));
  if (taxRate) lines.forEach((l) => (l.taxRate = taxRate));
  if (lines.length === 0) throw new Error("No line items found. Use one line per item: description | quantity | unit price | total");
  return finalize({
    vendorName: kv["vendor"] ?? kv["from"] ?? kv["supplier"], number: kv["invoice"] ?? kv["invoice#"] ?? kv["invoiceno"] ?? kv["invoicenumber"] ?? kv["invoicenumber"] ?? kv["no"],
    date: iso(kv["invoicedate"] ?? kv["date"]), dueDate: iso(kv["duedate"] ?? kv["due"]), currency: kv["currency"], taxRate, lines,
    subtotal: num(kv["subtotal"]), discounts: num(kv["discount"] ?? kv["discounts"]), taxAmount: num(kv["tax"] ?? kv["vat"]),
    total: num(kv["total"] ?? kv["amountdue"]), method: "text", defaultCurrency,
  });
}
