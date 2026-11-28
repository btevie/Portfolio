import { D, isValidDecimal, round2, str2 } from "../audit/money";
import { parseISO } from "../audit/normalize";
import { isCurrency, SYMBOLS } from "../currencies";
import type { Currency } from "../types";
import { cleanText } from "./sanitize";
import { looseRead } from "./loose";
import { splitLabelled } from "./split-labelled";
import { looksMedical } from "../medical";
import { MAX_DESC_CHARS, MAX_LINES, MAX_NUMBER_CHARS, MAX_VENDOR_CHARS, type ExtractedInvoice, type FieldKey } from "./types";

type Line = ExtractedInvoice["lines"][number];

const toCurrency = (raw: string | undefined): Currency | undefined => { const t = (raw ?? "").trim(); const up = t.toUpperCase(); return isCurrency(up) ? up : SYMBOLS[t]; };
const num = (s: string | undefined): string | undefined => {
  if (!s) return undefined;
  let cleaned = s;
  for (const symbol of Object.keys(SYMBOLS)) cleaned = cleaned.replaceAll(symbol, "");
  let c = cleaned.trim().replace(/^[A-Za-z]{3}\s+|\s+[A-Za-z]{3}$/g, "").replace(/\s/g, "");
  const comma = c.lastIndexOf(","), dot = c.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    // When both separators occur, the last one is the decimal separator.
    c = comma > dot ? c.replace(/\./g, "").replace(",", ".") : c.replace(/,/g, "");
  } else if (comma >= 0) {
    if (/^\d{1,3}(,\d{3})+$/.test(c)) c = c.replace(/,/g, "");
    else c = c.replace(",", ".");
  }
  // Amounts are normalized to non-negative values; credit-note documents are normalized before parsing.
  return isValidDecimal(c) && !c.startsWith("-") ? c : undefined;
};
const optionalNumber = (raw: string | undefined, field: string): string | undefined => {
  if (raw === undefined || !raw.trim()) return undefined;
  const value = num(raw);
  if (value === undefined) throw new Error(`${field} must be a non-negative number with up to 12 digits and 6 decimal places.`);
  return value;
};
const optionalRate = (raw: string | undefined, field: string): string | undefined => {
  if (raw === undefined || !raw.trim()) return undefined;
  const cleaned = raw.trim().endsWith("%") ? raw.trim().slice(0, -1).trim() : raw.trim();
  return optionalNumber(cleaned, field);
};
const iso = (s: string | undefined): string => {
  if (!s) return "";
  const t = s.trim();
  if (parseISO(t) !== null) return t;
  const ymd = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(t); // 2026/10/05 and 2026.10.05
  if (ymd) { const v = `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`; if (parseISO(v) !== null) return v; }
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    // Resolve only unambiguous slash dates. If both fields can be a month, ask the user instead of silently guessing.
    const [day, month] = a > 12 && b <= 12 ? [a, b] : b > 12 && a <= 12 ? [b, a] : [0, 0];
    if (day && month) {
      const v = `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return parseISO(v) !== null ? v : t;
    }
  }
  return t; // leave as-is: the date rule will flag it
};

function finalize(p: {
  vendorName?: string; number?: string; date?: string; dueDate?: string; currency?: string; taxRate?: string;
  lines: Line[]; subtotal?: string; discounts?: string; taxAmount?: string; total?: string; method: "csv" | "text" | "pdf" | "ocr"; defaultCurrency: Currency; isCredit?: boolean;
}): ExtractedInvoice {
  const items = p.lines.filter((l) => l.kind === "item");
  const feeLines = p.lines.filter((l) => l.kind === "fee");
  const inferredEu = !p.currency?.trim() && /\b(b\.v\.|n\.v\.|btw|kvk|incassokosten|factuur|zakelijk|toestelverzekering|papieren|verlegd|nl\d{2}[a-z]{4})\b/i.test([p.vendorName ?? "", ...p.lines.map((l) => l.description)].join(" "));
  const currency = toCurrency(p.currency) ?? (inferredEu ? "EUR" : undefined);
  if (p.currency?.trim() && !currency) throw new Error(`Currency "${cleanText(p.currency, 16)}" isn't recognized. Enter a supported ISO code or symbol, such as EUR or €.`);
  const vendorName = p.vendorName ? cleanText(p.vendorName, MAX_VENDOR_CHARS) || undefined : undefined;
  const number = p.number ? cleanText(p.number, MAX_NUMBER_CHARS) || undefined : undefined;
  const sumItems = items.reduce((a, l) => a.plus(D(l.total)), D(0));
  const fees = feeLines.reduce((a, l) => a.plus(D(l.total)), D(0));
  const discounts = D(p.discounts);
  const gross = p.lines.reduce((a, l) => a.plus(D(l.total)), D(0));
  const taxableGroups = new Map<string, ReturnType<typeof D>>();
  for (const l of p.lines) {
    const rate = l.taxRate ?? p.taxRate;
    if (rate === undefined) continue;
    const normalized = D(rate).toString();
    taxableGroups.set(normalized, (taxableGroups.get(normalized) ?? D(0)).plus(D(l.total)));
  }
  const estimatedTax = [...taxableGroups].reduce((total, [rate, base]) => {
    const discountShare = gross.isZero() ? D(0) : discounts.times(base).div(gross);
    return total.plus(base.minus(discountShare).times(D(rate)).div(100));
  }, D(0));
  // Stated values are kept as-is. Only genuinely absent ones are derived, so a wrong stated total still gets audited.
  const subtotal = p.subtotal ?? str2(sumItems);
  const taxAmount = p.taxAmount ?? (taxableGroups.size ? str2(estimatedTax) : "0.00");
  const total = p.total ?? str2(D(subtotal).minus(discounts).plus(D(taxAmount)).plus(fees));
  const low: FieldKey[] = [];
  if (!vendorName) low.push("vendorName");
  if (!number) low.push("number");
  if (!p.date || parseISO(p.date) === null) low.push("date");
  if (!p.dueDate || parseISO(p.dueDate) === null) low.push("dueDate");
  if (!p.currency?.trim() || ["$", "¥"].includes(p.currency.trim())) low.push("currency");
  if (p.total === undefined) low.push("total");
  return {
    vendorName: vendorName ?? "", number: number ?? "", date: p.date ?? "", dueDate: p.dueDate ?? "",
    currency: currency ?? p.defaultCurrency, lines: p.lines,
    subtotal, discounts: str2(discounts), fees: str2(fees), taxAmount, taxRate: p.taxRate, total, lowConfidence: low, method: p.method,
    ...(looksMedical(vendorName ?? "", p.lines.map((l) => l.description)) ? { medical: true } : {}),
    ...(p.isCredit ? { isCredit: true } : {}),
  };
}

const line = (description: string, quantity: string, unitPrice: string, total: string | undefined, kind: "item" | "fee", taxRate?: string): Line => ({
  description: cleanText(description, MAX_DESC_CHARS) || "Item", quantity, unitPrice, total: total ?? str2(round2(D(quantity).times(D(unitPrice)))), kind, taxRate,
});

/** Header-based CSV. Required: description, quantity, unit_price. Optional: line_total, kind, vendor, invoice_number, invoice_date, due_date, currency, tax_rate, discounts, tax, total, subtotal. */
export function parseCsv(text: string, defaultCurrency: Currency): ExtractedInvoice {
  const content = text.replace(/^\uFEFF/, "");
  const rows = splitCsv(content, detectDelimiter(content)).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one line item.");
  if (rows.length - 1 > MAX_LINES) throw new Error(`The CSV has more than ${MAX_LINES} line items. Split it into smaller invoices.`);
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (r: string[], ...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0 && r[i]?.trim()) return r[i].trim(); } return undefined; };
  for (const need of ["description", "quantity", "unit_price"]) if (!head.includes(need)) throw new Error(`The CSV is missing a "${need}" column.`);
  const first = (...n: string[]) => { for (const r of rows.slice(1)) { const v = col(r, ...n); if (v) return v; } return undefined; };
  const taxRate = optionalRate(first("tax_rate"), "Tax rate");
  const problems: string[] = [];
  const lines: Line[] = [];
  rows.slice(1).forEach((r, i) => {
    const q = num(col(r, "quantity")), p = num(col(r, "unit_price"));
    if (!q || !p) { problems.push(`Row ${i + 2}: ${!q ? "quantity" : "unit price"} "${(col(r, !q ? "quantity" : "unit_price") ?? "").slice(0, 20)}" is not a non-negative number (up to 12 digits)`); return; }
    const kind = col(r, "kind")?.toLowerCase() === "fee" ? "fee" : "item";
    const lineTotal = optionalNumber(col(r, "line_total", "total_line"), `Row ${i + 2} line total`);
    const lineRate = optionalRate(col(r, "line_tax_rate"), `Row ${i + 2} tax rate`);
    lines.push(line(col(r, "description") ?? "Item", q, p, lineTotal, kind, lineRate ?? taxRate));
  });
  if (problems.length) throw new Error(`${problems.slice(0, 5).join("; ")}${problems.length > 5 ? `; and ${problems.length - 5} more rows` : ""}. Fix these in your file and upload it again.`);
  return finalize({
    vendorName: first("vendor"), number: first("invoice_number"), date: iso(first("invoice_date")), dueDate: iso(first("due_date")),
    currency: first("currency"), taxRate, lines, subtotal: optionalNumber(first("subtotal"), "Subtotal"), discounts: optionalNumber(first("discounts"), "Discounts"),
    taxAmount: optionalNumber(first("tax"), "Tax amount"), total: optionalNumber(first("invoice_total", "total"), "Invoice total"), method: "csv", defaultCurrency,
  });
}

export function detectDelimiter(text: string): string {
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i + 1] === '"') { i++; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && (c === "\n" || c === "\r")) break;
    if (!quoted && counts.has(c)) counts.set(c, counts.get(c)! + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export function splitCsv(text: string, delimiter: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === delimiter) { row.push(cell); cell = ""; }
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
export function parseText(text: string, defaultCurrency: Currency, method: "text" | "pdf" | "ocr" = "text"): ExtractedInvoice {
  const kv: Record<string, string> = {};
  const lines: Line[] = [];
  // Two labelled fields on one line ("Invoice date: 12/11/2026   Due date: 26/11/2026") are two fields, not one long date.
  const split = text.split(/\r?\n/).flatMap((r) => (r.includes("|") ? [r] : splitLabelled(r)));
  for (const raw of split) {
    const l = raw.trim();
    if (!l) continue;
    if (l.includes("|")) {
      const [d, q, p, t, k] = l.split("|").map((x) => x.trim());
      const qn = num(q), pn = num(p);
      if (lines.length >= MAX_LINES) throw new Error(`More than ${MAX_LINES} line items. Split it into smaller invoices.`);
      if (!(d && qn && pn)) throw new Error(`Couldn't read the line "${l.slice(0, 60)}". Use: description | quantity | unit price | total`);
      lines.push(line(d, qn, pn, optionalNumber(t, "Line total"), k?.toLowerCase() === "fee" ? "fee" : "item"));
      continue;
    }
    // Split on the first ":" or "=" instead of a lazy regex: that regex backtracked quadratically on long runs of spaces.
    const sep = l.search(/[:=]/);
    if (sep > 0 && sep <= 60) {
      const key = l.slice(0, sep).trim(), value = l.slice(sep + 1).trim();
      if (key && value && /^[A-Za-z #./]+$/.test(key)) kv[key.toLowerCase().replace(/[^a-z]/g, "")] = value;
    }
  }
  const vatIsRate = Boolean(kv["vat"]?.trim().endsWith("%"));
  const taxRate = optionalRate(kv["taxrate"] ?? kv["vatrate"] ?? (vatIsRate ? kv["vat"] : undefined), "Tax rate");
  if (taxRate) lines.forEach((l) => (l.taxRate = taxRate));
  let loose: ReturnType<typeof looseRead> | undefined;
  if (lines.length === 0) {
    // Not in Overbill's own format (receipts, notes, other languages, tab-separated tables): read it loosely, and say what was assumed.
    loose = looseRead(text, defaultCurrency);
    if (!loose.lines.length) throw new Error("Couldn't find any line items or a total in that text. Paste the lines of the bill with their amounts, or use: description | quantity | unit price | total");
    for (const l of loose.lines) lines.push(line(l.description, l.quantity, l.unitPrice, l.total, l.kind));
  }
  const L = loose; // values the person wrote as "Key: value" win; the loose read only fills gaps
  const result = finalize({
    vendorName: kv["vendor"] ?? kv["from"] ?? kv["supplier"] ?? L?.vendorName, number: kv["invoice"] ?? kv["invoice#"] ?? kv["invoiceno"] ?? kv["invoicenumber"] ?? kv["no"] ?? L?.number,
    date: iso(kv["invoicedate"] ?? kv["date"] ?? L?.date), dueDate: iso(kv["duedate"] ?? kv["due"] ?? L?.dueDate), currency: kv["currency"] ?? L?.currency, taxRate: taxRate ?? L?.taxRate, lines,
    subtotal: optionalNumber(kv["subtotal"] ?? L?.subtotal, "Subtotal"), discounts: optionalNumber(kv["discount"] ?? kv["discounts"] ?? L?.discounts, "Discounts"),
    taxAmount: optionalNumber(kv["tax"] ?? (vatIsRate ? undefined : kv["vat"]) ?? L?.taxAmount, "Tax amount"),
    total: optionalNumber(kv["total"] ?? kv["amountdue"] ?? L?.total, "Invoice total"), method, defaultCurrency,
  });
  if (!L) return result;
  // Everything the loose read guessed must be confirmed by the person before the audit runs.
  const low = new Set(result.lowConfidence);
  low.add("total");
  if (L.ambiguousDate) low.add("date");
  return { ...result, lowConfidence: [...low], notes: L.notes };
}

/** Messy but realistic pastes, so people can see that "just paste whatever you have" works. */
export const MESSY_EXAMPLES: { label: string; text: string }[] = [
  { label: "A café receipt", text: "Bean There Coffee Co\nReceipt #4471  12 Nov 2026\n2x Flat white  7.00\n1x Croissant 3.50\nSubtotal 10.50\nVAT 21% 2.20\nTotal due: €12.70" },
  { label: "A note to myself", text: "hey here's the bill from northwind hosting\nthey charged me 166.98 this month for the server\nplus 9.99 backup addon\ntotal 176.97 thanks" },
  { label: "A Dutch utility bill", text: "ENERGIE NV\nFactuur nr: 2026-8812\nDatum 03-11-2026 Vervaldatum 17-11-2026\nStroom verbruik 312 kWh x 0,28 = 87,36\nVaste kosten 12,50\nBTW 21% 21,03\nTotaal te betalen 120,89 EUR" },
];

/** A ready-to-fill CSV in the format `parseCsv` reads. Header + one example row per kind. */
export const CSV_TEMPLATE = `description,quantity,unit_price,line_total,kind,vendor,invoice_number,invoice_date,due_date,currency,tax_rate,discounts,tax,total
Business fibre 500/500,1,49.00,49.00,item,Example Telecom,INV-1001,2026-11-01,2026-11-15,EUR,21,0,11.34,65.34
Static IP address,1,5.00,5.00,fee,,,,,,,,,
`;
