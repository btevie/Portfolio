/**
 * Turns the text lines of an invoice PDF into the "Key: value" + "description | qty | unit | total" form that
 * `parseText` already understands, so PDFs go through exactly the same validation as pasted text.
 * Pure and deterministic: no PDF library in here, which keeps it unit-testable.
 */

import { isCurrency } from "../currencies";
import { D, sum } from "../audit/money";
import { splitLabelled } from "./split-labelled";

const MONEY =/^[-(]?[€$£¥]?\d[\d.,]*\)?$/;
const KEYWORD = /^(sub\s*-?\s*total|total(?:\s+due)?|amount\s+due|balance\s+due|grand\s+total|tax|vat|gst|discount|shipping|payment|invoice|date|due|currency|bill\s+to|ship\s+to|page)\b/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const stripMoney = (s: string) => s.replace(/\b[A-Z]{3}\b/g, "").replace(/[€$£¥]/g, "").replace(/\s+/g, "");
/** "9,00", "1.234,56" and "1,234.56" as numbers. Only used to add up several tax lines; single values pass through as written. */
function toDecimal(a: string) {
  const comma = a.lastIndexOf(","), dot = a.lastIndexOf(".");
  let n = a;
  if (comma >= 0 && dot >= 0) n = comma > dot ? a.replace(/\./g, "").replace(",", ".") : a.replace(/,/g, "");
  else if (comma >= 0) n = /^\d{1,3}(,\d{3})+$/.test(a) ? a.replace(/,/g, "") : a.replace(",", ".");
  return D(n.replace(/[()]/g, ""));
}
const isMoney = (t: string) => MONEY.test(t.replace(/^[A-Z]{3}$/, ""));

/** Splits trailing numeric tokens off a line: "Hosting 3 10.00 30.00" -> ["Hosting", ["3","10.00","30.00"]] */
function splitTrailingNumbers(line: string): [string, string[]] {
  const tokens = line.split(/\s+/);
  // A currency code after the amounts ("Hosting 1 10.00 10.00 EUR") is not another number.
  if (tokens.length > 2 && /^[A-Z]{3}$/.test(tokens[tokens.length - 1]) && isCurrency(tokens[tokens.length - 1]) && isMoney(tokens[tokens.length - 2])) tokens.pop();
  const nums: string[] = [];
  while (tokens.length > 1 && isMoney(tokens[tokens.length - 1])) nums.unshift(stripMoney(tokens.pop()!));
  return [tokens.join(" "), nums];
}

const LABELS: [RegExp, string][] = [
  [/^invoice\s*(?:no\.?|number|num|#)\s*[:#]?\s*(.+)$/i, "Invoice #"],
  [/^invoice\s*date\s*[:]?\s*(.+)$/i, "Invoice date"],
  [/^(?:date\s*of\s*issue|issue\s*date|date)\s*[:]?\s*(.+)$/i, "Invoice date"],
  [/^(?:payment\s*)?due(?:\s*date)?\s*[:]?\s*(.+)$/i, "Due date"],
  [/^(?:vendor|supplier|from|seller)\s*[:]?\s*(.+)$/i, "Vendor"],
  [/^currency\s*[:]?\s*([A-Za-z]{3})\b/i, "Currency"],
  [/^sub\s*-?\s*total\s*[:]?\s*(.+)$/i, "Subtotal"],
  // "Total excl. VAT 120.20" is the subtotal and "Total VAT 25.24" is the tax: neither is the grand total.
  [/^total\s*(?:excl(?:uding)?\.?|ex\.?|net|before)\b[^\d]*?(\d.*)$/i, "Subtotal"],
  [/^total\s*(?:vat|tax|gst)\b[^\d]*?(\d.*)$/i, "Tax"],
  [/^(?:discounts?)\s*[:]?\s*-?\s*(.+)$/i, "Discount"],
  // Qualified intermediate totals ("Total before discount", "Total so far") are not the final amount.
  [/^(?:grand\s+total|total\s+due|amount\s+due|balance\s+due)\s*[:]?\s*(.+)$/i, "Total"],
  // The exclusion sits before the optional whitespace, so "Total so far 50.00" cannot slip past it by matching zero spaces.
  [/^total(?!\s*(?:before|so\s+far|excl|ex\.|net|vat|tax|gst|for\b))\s*[:]?\s*(.+)$/i, "Total"],
];

export function pdfLinesToText(rawLines: string[]): string {
  const lines = rawLines.flatMap((r) => splitLabelled(r)).map(clean).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  const taxRates: string[] = [], taxAmounts: string[] = [];
  const put = (k: string, v: string) => { if (!seen.has(k) && v) { seen.add(k); out.push(`${k}: ${v}`); } };

  for (const l of lines) {
    // Tax line first: "Tax (21%) 11.34" / "VAT 21% 11.34" / "VAT: 11.34"
    const tax = /^(?:tax|vat|gst)\b(?:\s+rate)?[^\dA-Za-z%-]*?(?:\(?(\d{1,2}(?:[.,]\d+)?)\s*%\)?)?[\s:]*([€$£¥]?\s*[\d.,]*\d)?\s*$/i.exec(l);
    if (tax && (tax[1] || tax[2])) {
      if (tax[1]) taxRates.push(tax[1].replace(",", "."));
      if (tax[2]) taxAmounts.push(stripMoney(tax[2]));
      continue;
    }
    let matched = false;
    for (const [re, key] of LABELS) {
      const m = re.exec(l);
      if (!m) continue;
      let v = m[1].trim();
      if (["Subtotal", "Discount", "Total", "Tax"].includes(key)) {
        // The last amount, including space-grouped digits ("1 234,56"), taken whole before grouping is removed.
        // A currency code after the amount ("Total 121.00 EUR") is not part of it.
        const trailing = /\s+([A-Za-z]{3})$/.exec(v);
        const body = trailing && isCurrency(trailing[1].toUpperCase()) ? v.slice(0, -trailing[0].length) : v;
        const amount = /((?:[-−(]\s*)?(?:[€$£¥]\s*)?\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?\)?|[-(]?[€$£¥]?\d[\d.,]*\)?)\s*$/.exec(body);
        if (!amount || !isMoney(amount[1].replace(/[ \u00a0]/g, ""))) continue;
        v = stripMoney(amount[1]);
        // "Total EUR 65.34": remember the currency if the document states it. Only real ISO codes count: "Total incl. VAT" must not become currency "VAT".
        const cur = (m[1].match(/\b[A-Z]{3}\b/g) ?? []).find(isCurrency);
        if (cur) put("Currency", cur);
      }
      put(key, v);
      matched = true;
      break;
    }
    if (matched) continue;
    // Item row: description then 3 numbers (qty, unit, total), or 2 equal numbers (qty 1).
    const [desc, nums] = splitTrailingNumbers(l);
    // "Shipping 1 5.00 5.00" is a real charge, not a header; only skip keyword rows that are not shaped like items.
    const chargeRow = /^(shipping|payment)\b/i.test(l) && (nums.length >= 3 || (nums.length === 2 && nums[0] === nums[1]));
    if (KEYWORD.test(l) && !chargeRow) continue;
    if (desc && /[A-Za-z]/.test(desc)) {
      if (nums.length >= 3) { const [q, u, t] = nums.slice(-3); out.push(`${desc} | ${q} | ${u} | ${t}`); continue; }
      if (nums.length === 2 && nums[0] === nums[1]) { out.push(`${desc} | 1 | ${nums[0]} | ${nums[1]}`); continue; }
    }
  }
  // Several tax lines (VAT 9% and VAT 21%): add the amounts and do not apply any single rate to every item.
  if (taxAmounts.length) put("Tax", taxAmounts.length > 1 ? sum(taxAmounts.map(toDecimal)).toFixed(2) : taxAmounts[0]);
  if (taxRates.length && new Set(taxRates).size === 1) put("Tax rate", taxRates[0]);
  if (lines.some((l) => /^(credit\s*(note|memo))\b/i.test(l) && !/\d/.test(l))) out.unshift("Type: credit note");
  // No labelled vendor: the first real line of an invoice is nearly always the issuing company.
  if (!seen.has("Vendor")) {
    const first = lines.find((l) => /[A-Za-z]{3}/.test(l) && !/^(invoice|tax invoice|receipt|bill|page)\b/i.test(l) && !isMoney(l.split(" ")[0]));
    if (first) out.unshift(`Vendor: ${first.slice(0, 100)}`);
  }
  return out.join("\n");
}

/** Rebuilds visual lines from positioned text items (pdf.js gives x/y per fragment, not lines). */
export function groupIntoLines(items: { str: string; x: number; y: number; w: number }[]): string[] {
  const rows: { y: number; parts: { x: number; w: number; str: string }[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const row = rows.find((r) => Math.abs(r.y - it.y) < 2.5);
    if (row) row.parts.push({ x: it.x, w: it.w, str: it.str });
    else rows.push({ y: it.y, parts: [{ x: it.x, w: it.w, str: it.str }] });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => {
    const parts = r.parts.sort((a, b) => a.x - b.x);
    let line = "";
    let end = -Infinity;
    for (const p of parts) { line += (line && p.x - end > 1 ? " " : "") + p.str; end = p.x + p.w; }
    return line;
  });
}
