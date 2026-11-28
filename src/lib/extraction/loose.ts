import { D } from "../audit/money";
import { parseISO } from "../audit/normalize";
import { isCurrency } from "../currencies";
import { cleanText } from "./sanitize";
import { MAX_DESC_CHARS, MAX_LINES, MAX_VENDOR_CHARS } from "./types";

/**
 * A forgiving reader for pasted text that is not in Overbill's own `a | b | c | d` format: receipts, emailed bills, notes to
 * yourself, bills in Dutch or German, tab-separated tables. It only *proposes* figures: every field it fills in is shown to
 * the user for confirmation, and `notes` says what was assumed.
 */

export interface LooseLine { description: string; quantity: string; unitPrice: string; total: string; kind: "item" | "fee" }
export interface LooseRead {
  vendorName?: string; number?: string; date?: string; dueDate?: string; currency?: string; taxRate?: string;
  lines: LooseLine[]; subtotal?: string; discounts?: string; taxAmount?: string; total?: string;
  /** Dates that could be day-first or month-first. */
  ambiguousDate: boolean;
  /** True when no line items were found and a single "total" line was made from the stated total. */
  totalOnly: boolean;
  notes: string[];
}

/** One amount: optional symbol, digits with optional thousands groups, optional 1–2 decimals. */
const MONEY = /(?:[€$£¥]\s?)?\d+(?:[., ]\d{3})*(?:[.,]\d{1,2})?(?:\s?[€$£])?/g;
const PERCENT = /\d+(?:[.,]\d+)?\s?%/g;
const SYMBOL_CODE: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP" };

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, januar: 1, feb: 2, februari: 2, februar: 2, mar: 3, mrt: 3, maart: 3, mär: 3, märz: 3, march: 3, apr: 4, april: 4,
  may: 5, mei: 5, mai: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, augustus: 8, sep: 9, sept: 9, september: 9, oct: 10, okt: 10, oktober: 10, october: 10,
  nov: 11, november: 11, dec: 12, dez: 12, december: 12, dezember: 12,
};
const MONTH_RX = "(" + Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|") + ")";
const DATE_PATTERNS: { rx: RegExp; read: (m: RegExpExecArray) => { y: number; m: number; d: number; ambiguous?: boolean } | null }[] = [
  { rx: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, read: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  { rx: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[ -]${MONTH_RX}\\.?,?[ -](\\d{4})\\b`, "gi"), read: (m) => ({ y: +m[3], m: MONTHS[m[2].toLowerCase()], d: +m[1] }) },
  { rx: new RegExp(`\\b${MONTH_RX}\\.?\\s(\\d{1,2})(?:st|nd|rd|th)?,?\\s(\\d{4})\\b`, "gi"), read: (m) => ({ y: +m[3], m: MONTHS[m[1].toLowerCase()], d: +m[2] }) },
  {
    rx: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g,
    read: (m) => {
      const a = +m[1], b = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      if (a > 12 && b <= 12) return { y, m: b, d: a };
      if (b > 12 && a <= 12) return { y, m: a, d: b };
      if (a === b) return { y, m: a, d: b };
      return { y, m: b, d: a, ambiguous: true }; // day-first, as written in most of the world; the user confirms
    },
  },
];
const isoOf = (y: number, m: number, d: number) => {
  const v = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return parseISO(v) !== null ? v : null;
};

/** "1.234,56" / "1,234.56" / "12,50" / "12.50" / "€ 12" -> "1234.56" … or null. */
export function looseAmount(raw: string): string | null {
  let s = raw.replace(/[€$£¥]| /g, "").replace(/\s/g, "");
  if (!s || !/^\d[\d.,]*$/.test(s)) return null;
  const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (dot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // "1.234" is 1234, not 1.234
  return /^\d{1,12}(\.\d{1,2})?$/.test(s) ? s : null;
}

const money = (line: string): { text: string; value: string; hasDecimals: boolean; hasSymbol: boolean; index: number }[] => {
  const out: { text: string; value: string; hasDecimals: boolean; hasSymbol: boolean; index: number }[] = [];
  for (const m of line.matchAll(MONEY)) {
    const value = looseAmount(m[0]);
    if (value === null) continue;
    out.push({ text: m[0], value, hasDecimals: /[.,]\d{1,2}(?!\d)/.test(m[0].replace(/\s?[€$£]$/, "")) && value.includes("."), hasSymbol: /[€$£]/.test(m[0]), index: m.index ?? 0 });
  }
  return out;
};

const SUBTOTAL = /\b(sub[\s-]?total|subtotaal|zwischensumme|net(?:to)?|excl\.?\s*(?:vat|btw|tax|mwst))\b/i;
const DISCOUNT = /\b(discount|korting|rabatt|promo(?:tion)?|coupon|voucher|insurance\s+(?:adjust\w*|paid|payment)|plan\s+(?:paid|discount)|contractual\s+adjust\w*|network\s+(?:discount|savings)|adjustments?)\b/i;
const TAX = /\b(vat|btw|tax|mwst|ust|iva|gst|tva)\b/i;
const TOTAL = /\b(patient\s+(?:balance|responsibility|owes)|(?:amount|balance)\s+you\s+owe|you\s+owe|new\s+balance|statement\s+balance|pay\s+this\s+amount|grand\s+total|total\s+(?:due|amount|to\s+pay|payable|incl\.?\w*)|amount\s+(?:due|payable)|balance\s+due|totaal(?:\s+te\s+betalen)?|te\s+betalen|gesamt(?:betrag)?|summe|total|due)\b/i;
const FEE = /\b(fee|fees|surcharge|admin|administration|late|delivery|shipping|postage|handling|service\s+charge|toeslag|kosten|gebühr|booking)\b/i;
const NOISE = /(@|https?:|www\.|\biban\b|\bkvk\b|\bbtw[-\s]?nr|\bvat\s*(?:id|no|number|reg)|\btel\b|\bphone\b|\bfax\b|\bpage\s+\d|\bkvk\b|\bswift\b|\bbic\b)/i;
const CHATTER = /^(?:hey|hi|hello|dear|thanks?|thank you|cheers|regards|fyi|here(?:'|’)?s|please|can you|could you)\b/i;
const AFTER_FILLER = /^(?:(?:this|that|last|next|per)\s+(?:month|week|year|quarter)\s*)?(?:(?:for|on|the|a|an|to|of|my|our|their|his|her)\s+)+/i;
const FILLER = /^(?:(?:and|plus|also|then|another|they|charged|me|i|paid|got|a|an|the|for|of|was|is)\s+)+/i;

const titleCase = (s: string) => (s === s.toLowerCase() ? s.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : s);
const trimDesc = (s: string) => cleanText(s.replace(/^[\s\-–—:.,;|*•·]+|[\s\-–—:.,;|*•·]+$/g, "").replace(/\s{2,}/g, " "), MAX_DESC_CHARS);
const unitOf = (total: string, qty: string) => {
  const q = D(qty);
  if (q.lte(0)) return total;
  const s = D(total).div(q).toDecimalPlaces(6).toFixed();
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, ".00").replace(/\.(\d)$/, ".$10") : `${s}.00`;
};
const near = (a: string, b: string) => D(a).minus(D(b)).abs().lte("0.02");

export function looseRead(text: string, preferred?: string): LooseRead {
  const notes: string[] = [];
  const rawLines = text.split(/\r?\n/).map((l) => l.replace(/ /g, " ").trim()).filter(Boolean).slice(0, 600);

  // ---- dates ----
  let ambiguousDate = false;
  const dates: { iso: string; role: "due" | "invoice" | "none"; ambiguous: boolean }[] = [];
  const scrub = (line: string) => {
    let rest = line;
    for (const p of DATE_PATTERNS) {
      p.rx.lastIndex = 0;
      rest = rest.replace(p.rx, (...args) => {
        const m = args.slice(0, -2) as unknown as RegExpExecArray;
        const offset = args[args.length - 2] as number;
        const r = p.read(m);
        const iso = r ? isoOf(r.y, r.m, r.d) : null;
        if (!iso) return " ";
        // The label belongs to the date right after it: look only at the words just before this date.
        const before = line.slice(Math.max(0, offset - 26), offset);
        const role = /(due|verval\w*|pay\s*by|payable\s+by|fällig|betaal\w*|uiterlijk)\W*$/i.test(before) ? "due" : /(date|datum|issued|invoice|factuur|receipt|bon|rechnung)\W*$/i.test(before) ? "invoice" : "none";
        dates.push({ iso, role, ambiguous: Boolean(r?.ambiguous) });
        return " ";
      });
    }
    return rest;
  };

  // ---- currency ----
  let currency: string | undefined;
  const code = /\b(EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|AUD|CAD|NZD|JPY|INR)\b/.exec(text.toUpperCase())?.[1];
  const symbol = /[€$£]/.exec(text)?.[0];
  if (code && isCurrency(code)) currency = code;
  else if (symbol) currency = SYMBOL_CODE[symbol];
  else if (/\b(euro|eur)\b/i.test(text)) currency = "EUR";

  const lines: LooseLine[] = [];
  const totals: { value: string; prio: number }[] = [];
  let subtotal: string | undefined, discounts: string | undefined, taxAmount: string | undefined, taxRate: string | undefined;
  let number: string | undefined, vendorName: string | undefined;
  let usedQtyPrefix = false;

  for (const raw of rawLines) {
    const noPercent = raw.replace(PERCENT, (p) => { if (!taxRate && TAX.test(raw)) taxRate = looseAmount(p.replace("%", "").trim()) ?? undefined; return " "; });
    const line = scrub(noPercent).replace(/\s{2,}/g, "  ").trim();

    // invoice number
    if (!number) {
      const m = /\b(?:invoice|inv|factuur|rechnung|receipt|bill|order|ref(?:erence)?|bon)\s*(?:no\.?|nr\.?|number|nummer|#)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/_.]{2,30})/i.exec(raw) ?? /(?:#|\bno\.?\s|\bnr\.?\s)\s*([A-Z0-9][\w\-/]{2,30})/i.exec(raw);
      if (m && /\d/.test(m[1]) && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(m[1])) number = m[1].replace(/[.,;]+$/, "");
    }
    // vendor named in a sentence
    if (!vendorName) {
      const m = /\b(?:bill|invoice|receipt|statement|charge|email)\s+from\s+([^\n,.;:!?]{2,60})/i.exec(raw) ?? /^(?:from|vendor|supplier|merchant|seller)\s*[:\-]\s*(.{2,60})$/i.exec(raw);
      if (m) vendorName = trimDesc(m[1]);
    }

    const amounts = money(line);
    const keyword = SUBTOTAL.test(line) ? "sub" : DISCOUNT.test(line) ? "disc" : TOTAL.test(line) && (/incl|total/i.test(line) || !TAX.test(line)) && !/\btotal\s+(?:vat|tax|btw)\b/i.test(line) ? "total" : TAX.test(line) ? "tax" : null;
    if (keyword && amounts.length) {
      const v = amounts[amounts.length - 1].value;
      if (keyword === "sub") subtotal = v;
      else if (keyword === "disc") discounts = v;
      else if (keyword === "tax") taxAmount = v;
      else totals.push({ value: v, prio: /grand|due|payable|te betalen|balance|amount|patient|owe/i.test(line) ? 2 : 1 });
      continue;
    }
    if (keyword) continue;
    if (NOISE.test(line) || !amounts.length) continue;

    // ---- a line item ----
    let desc = line;
    let qty: string | undefined;
    const prefix = /^(\d+(?:[.,]\d+)?)\s*[x×]\s+/i.exec(desc) ?? (/^(?:\d{5}|[A-Z]\d{4})\b/.test(desc) ? null : /^(\d{1,3})\s+(?=\p{L})/u.exec(desc));
    if (prefix && looseAmount(prefix[1])) { qty = looseAmount(prefix[1])!; desc = desc.slice(prefix[0].length); }
    const suffixQty = /\s[x×]\s*(\d+(?:[.,]\d+)?)\b(?!\s*[.,]\d)/i.exec(desc);
    const found = money(desc);
    // Integers with no symbol and no decimals are quantities, ids or years, unless they sit in a column of numbers.
    const priced = found.filter((a) => a.hasDecimals || a.hasSymbol);
    if (!priced.length && found.length < 3) continue;
    const nums = priced.length >= 1 && found.length < 3 ? priced : found;
    const firstAt = Math.min(...nums.map((a) => a.index));
    let label = desc.slice(0, firstAt);
    if (!trimDesc(label)) label = desc.slice(nums[nums.length - 1].index + nums[nums.length - 1].text.length) || desc.replace(MONEY, " ");
    label = label.replace(/\s[x×=]\s*$/i, "");
    let total: string, quantity = qty ?? "1", unit: string | undefined;
    const vals = nums.map((a) => a.value);
    if (vals.length >= 3 && near(D(vals[vals.length - 3]).times(vals[vals.length - 2]).toFixed(2), vals[vals.length - 1])) {
      quantity = vals[vals.length - 3]; unit = vals[vals.length - 2]; total = vals[vals.length - 1];
    } else if (vals.length === 2 && qty && near(D(qty).times(vals[0]).toFixed(2), vals[1])) {
      unit = vals[0]; total = vals[1];
    } else if (vals.length === 2 && !qty && D(vals[0]).gt(0) && Number.isInteger(+vals[1] / +vals[0]) && +vals[1] / +vals[0] > 1 && +vals[1] / +vals[0] <= 1000) {
      quantity = String(+vals[1] / +vals[0]); unit = vals[0]; total = vals[1];
    } else {
      total = vals[vals.length - 1];
      if (suffixQty && !qty) quantity = looseAmount(suffixQty[1]) ?? "1";
      if (qty) usedQtyPrefix = true;
    }
    if (D(total).lte(0) || D(quantity).lte(0)) continue;
    // "they charged me 166.98 this month for the server": the words before the amount are only filler, so use what comes after it.
    const before = trimDesc(label.replace(FILLER, ""));
    const lastAmount = nums[nums.length - 1];
    const after = trimDesc(trimDesc(desc.slice(lastAmount.index + lastAmount.text.length)).replace(AFTER_FILLER, ""));
    const description = (before.length >= 3 ? before : after.length >= 2 ? after : before || trimDesc(label)) || "Item";
    if (lines.length >= MAX_LINES) break;
    lines.push({ description, quantity, unitPrice: unit ?? unitOf(total, quantity), total, kind: FEE.test(description) ? "fee" : "item" });
  }

  // ---- dates → invoice / due ----
  const invoiceDate = dates.find((d) => d.role === "invoice") ?? dates.find((d) => d.role === "none");
  const dueDate = dates.find((d) => d.role === "due") ?? dates.find((d) => d !== invoiceDate && d.role === "none");
  ambiguousDate = Boolean((invoiceDate?.ambiguous) || (dueDate?.ambiguous));

  // ---- vendor: first plain line that is not chatter, a heading or a figure ----
  if (!vendorName) {
    const first = rawLines.slice(0, 6).find((l) => {
      const t = l.replace(/^[#*\-\s]+/, "");
      return /\p{L}{2}/u.test(t) && t.length <= MAX_VENDOR_CHARS && !CHATTER.test(t) && !money(scrub(t)).some((a) => a.hasDecimals || a.hasSymbol) && !NOISE.test(t)
        && !/^(?:invoice|receipt|bill|factuur|rechnung|statement|tax invoice|order|date|datum|due)\b/i.test(t) && !/[:=]/.test(t) && t.split(/\s+/).length <= 8;
    });
    if (first) vendorName = titleCase(trimDesc(first.replace(/^[#*\-\s]+/, "")));
  } else vendorName = titleCase(vendorName.slice(0, MAX_VENDOR_CHARS));

  const best = totals.sort((a, b) => a.prio - b.prio).at(-1)?.value;
  let totalOnly = false;
  if (!lines.length && best) {
    lines.push({ description: "Invoice total (no line items found)", quantity: "1", unitPrice: best, total: best, kind: "item" });
    totalOnly = true;
    notes.push("No individual line items were found, so there is one line for the stated total. Most checks need real line items: add them if you can.");
  }
  if (lines.length && !totalOnly) notes.push(`Read ${lines.length} line${lines.length === 1 ? "" : "s"} from free text by matching amounts and keywords. Check each one against the bill.`);
  if (usedQtyPrefix) notes.push("Where a line starts with a quantity (for example “2x”), the amount was taken as the line total, not the price of one.");
  if (ambiguousDate) notes.push("A date like 03/11/2026 could be day-first or month-first. It was read day-first: confirm it.");
  if (preferred && currency && currency !== preferred) notes.push(`The text mentions ${currency}, not your usual ${preferred}.`);

  return {
    vendorName, number, date: invoiceDate?.iso, dueDate: dueDate?.iso, currency, taxRate,
    lines, subtotal, discounts, taxAmount, total: best, ambiguousDate, totalOnly, notes,
  };
}
