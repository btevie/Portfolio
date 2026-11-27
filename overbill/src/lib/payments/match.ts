import { D, Decimal } from "../audit/money";
import { normalizeInvoiceNumber, normalizeVendor, parseISO } from "../audit/normalize";
import type { Invoice } from "../types";
import { isSimulated } from "../evidence";

export interface BankTx { date: string; description: string; amount: string; line: number }
/** How much the evidence supports a match. Even "strong" is a suggestion for the user to check, never a confirmed duplicate. */
export type MatchStrength = "strong" | "medium" | "weak";
export const STRENGTH_LABEL: Record<MatchStrength, string> = { strong: "Strong match", medium: "Possible match", weak: "Weak match" };

export interface DuplicatePayment {
  /** Stable for the same transactions, so a dismissal survives re-reading the same file. */
  id: string;
  strength: MatchStrength;
  /** Plain-language evidence behind the flag, one fact per line. */
  reasons: string[];
  kind: "same-invoice" | "repeat-charge";
  vendorName: string;
  invoice?: Invoice;
  txs: BankTx[];
  /** Money paid more than once: (payments − 1) × amount. */
  refundable: Decimal;
  why: string;
  /** Same-vendor, same-currency invoices the user could link instead (empty for repeat charges). */
  alternatives?: Invoice[];
  /** How many of the payments the invoices on file already explain (1 for a single invoice). */
  covered?: number;
}

function splitRows(text: string, delimiter: string): string[][] {
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
  return out.filter((r) => r.some((c) => c.trim()));
}

/** "1.234,56", "1,234.56", "(12.50)", "-12.50", "€12.50" -> signed number string, or null. */
export function toAmount(raw: string | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[€$£¥]|\b[A-Za-z]{3}\b/g, "").replace(/\s/g, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-") || s.startsWith("−")) { neg = !neg; s = s.slice(1); } else if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(s)) return null;
  return `${neg ? "-" : ""}${s}`;
}

function toDate(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  if (parseISO(t.slice(0, 10)) !== null) return t.slice(0, 10);
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(t);
  if (!m) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // day first, as in most bank exports
  return parseISO(iso) !== null ? iso : "";
}

/** How the file marks money leaving the account. Never guessed silently: see `ambiguous`. */
export type SignConvention = "negative-out" | "positive-out" | "split-columns";
export const CONVENTION_LABEL: Record<SignConvention, string> = {
  "negative-out": "Payments are negative (-12.50), money received is positive",
  "positive-out": "Payments are positive (12.50), refunds and money received are negative",
  "split-columns": "Separate Debit (paid out) and Credit (received) columns",
};

export interface StatementRow { line: number; status: "out" | "in" | "unreadable"; reason?: string; raw: string }
export interface ParsedStatement {
  txs: BankTx[];
  /** Money received (ignored for duplicate payments, but counted and listed so nothing disappears silently). */
  incoming: BankTx[];
  unreadable: StatementRow[];
  /** Kept for callers that only need a count. */
  skipped: number;
  convention?: SignConvention;
  /** True when a single Amount column has no negative numbers, so the direction can't be told from the file. The caller must ask. */
  ambiguous?: boolean;
  error?: string;
}

/** Reads a bank or card statement CSV. Only money going out is kept; everything else is accounted for in `incoming` / `unreadable`. */
export function parseStatement(text: string, opts: { convention?: SignConvention } = {}): ParsedStatement {
  const empty = { txs: [], incoming: [], unreadable: [], skipped: 0 };
  // Excel and bank exports commonly prefix UTF-8 CSVs with a BOM. Strip it before delimiter/header detection.
  const content = text.replace(/^\uFEFF/, "");
  const first = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows = splitRows(content, delimiter);
  if (rows.length < 2) return { ...empty, error: "The file needs a header row and at least one transaction." };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const dateI = find(/date|datum|fecha|data\b/);
  const descIs = head.map((h, i) => (/(description|details|memo|narrative|reference|payee|merchant|name|particulars|omschrijving|beschrijving|verwendungszweck|buchungstext|libell|concepto|descripci)/.test(h) ? i : -1)).filter((i) => i >= 0);
  const amountI = find(/^(amount|value|sum)\b|\bamount\b/);
  const outI = find(/(debit|d[eé]bit|withdrawal|paid out|money out|outgoing|soll|af\b)/);
  const inI = find(/(credit|cr[eé]dit|deposit|paid in|money in|incoming|haben|bij\b)/);
  if (dateI < 0 || !descIs.length || (amountI < 0 && outI < 0)) return { ...empty, error: "Couldn't find the date, description and amount columns. Export your statement as CSV with headers such as Date, Description and Amount." };

  const split = outI >= 0 && amountI < 0;
  const parsed = rows.slice(1).map((r, k) => ({ r, line: k + 2 }));
  let convention: SignConvention | undefined = split ? "split-columns" : opts.convention;
  let ambiguous = false;
  if (!split && !convention) {
    const signed = parsed.map(({ r }) => toAmount(r[amountI])).filter((a): a is string => a !== null);
    if (signed.some((a) => a.startsWith("-"))) convention = "negative-out"; // a mix of signs: negatives are the payments
    else ambiguous = signed.length > 0; // all one sign: the file doesn't say which direction it is
  }
  if (ambiguous) return { ...empty, ambiguous: true };

  const txs: BankTx[] = [], incoming: BankTx[] = [], unreadable: StatementRow[] = [];
  for (const { r, line } of parsed) {
    if (!r.some((c) => c.trim())) continue;
    const raw = r.map((c) => c.trim()).filter(Boolean).join(" · ").slice(0, 160);
    const date = toDate(r[dateI]);
    const description = descIs.map((i) => r[i]?.trim()).filter(Boolean).join(" ").slice(0, 200);
    let out: string | null = null, inn: string | null = null, unclear = "";
    if (split) {
      const o = toAmount(r[outI]), c = inI >= 0 ? toAmount(r[inI]) : null;
      if (o !== null) out = o.replace("-", ""); else if (c !== null) inn = c.replace("-", "");
      else unclear = "No readable amount in the Debit or Credit column";
    } else {
      const a = toAmount(r[amountI]);
      if (a === null) unclear = `Amount "${(r[amountI] ?? "").trim().slice(0, 20) || "(empty)"}" is not a number`;
      else {
        const negative = a.startsWith("-"), abs = negative ? a.slice(1) : a;
        if ((convention === "negative-out") === negative) out = abs; else inn = abs;
      }
    }
    if (!date) unclear = unclear || `Date "${(r[dateI] ?? "").trim().slice(0, 20) || "(empty)"}" is not recognised (use YYYY-MM-DD or DD/MM/YYYY)`;
    if (!description) unclear = unclear || "No description";
    if (unclear) { unreadable.push({ line, status: "unreadable", reason: unclear, raw }); continue; }
    if (inn !== null && D(inn).gt(0)) incoming.push({ date, description, amount: D(inn).toFixed(2), line });
    else if (out !== null && D(out).gt(0)) txs.push({ date, description, amount: D(out).toFixed(2), line });
  }
  return { txs, incoming, unreadable, skipped: unreadable.length, convention };
}

const idOf = (txs: BankTx[]) => txs.map((t) => `${t.date}|${t.amount}|${t.line}`).join(";");
const sameVendor = (inv: Invoice, bills: Invoice[]) => bills.filter((b) => b.currency === inv.currency && normalizeVendor(b.vendorName) === normalizeVendor(inv.vendorName));
const days = (a: string, b: string) => Math.abs(((parseISO(a) ?? 0) - (parseISO(b) ?? 0)) / 86_400_000);
const words = (s: string) => normalizeVendor(s).split(/\s+/).filter((w) => w.length >= 4);

const sameAmount = (tx: BankTx, inv: Invoice) => D(tx.amount).eq(D(inv.total));
function numberInMemo(tx: BankTx, inv: Invoice): boolean {
  const target = normalizeInvoiceNumber(inv.number);
  if (target.length < 3) return false;
  const tokens = tx.description.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  // Join small adjacent groups to support invoice numbers written with different separators, but require a whole match.
  for (let start = 0; start < tokens.length; start++) {
    for (let count = 1; count <= Math.min(5, tokens.length - start); count++) {
      if (normalizeInvoiceNumber(tokens.slice(start, start + count).join("-")) === target) return true;
    }
  }
  return false;
}
const vendorInMemo = (tx: BankTx, inv: Invoice) => { const memo = normalizeVendor(tx.description); return words(inv.vendorName).some((w) => memo.includes(w)); };

/** Money paid twice. Matching is deliberately conservative and always shows its reasoning; the user decides. */
export function findDuplicatePayments(txs: BankTx[], invoices: Invoice[]): DuplicatePayment[] {
  const bills = invoices.filter((i) => !i.isCredit && !isSimulated(i));
  const out: DuplicatePayment[] = [];
  const used = new Set<number>();

  // 1. The memo names the invoice number: two such payments for one invoice is a double payment.
  const byInvoice = new Map<string, { inv: Invoice; hits: BankTx[] }>();
  for (const t of txs) {
    const inv = bills.find((i) => sameAmount(t, i) && numberInMemo(t, i));
    if (!inv) continue;
    used.add(t.line);
    const g = byInvoice.get(inv.id) ?? { inv, hits: [] };
    g.hits.push(t); byInvoice.set(inv.id, g);
  }
  for (const { inv, hits } of byInvoice.values()) {
    if (hits.length < 2) continue;
    out.push({ id: idOf(hits), strength: "strong", alternatives: sameVendor(inv, bills),
      reasons: [`Each payment is ${inv.total}, exactly the total of invoice ${inv.number}.`, `Each description contains the invoice number ${inv.number}.`, `${hits.length} payments, but the invoice was billed once.`],
      kind: "same-invoice", vendorName: inv.vendorName, invoice: inv, txs: hits, refundable: D(inv.total).times(hits.length - 1),
      why: `${hits.length} payments of ${inv.total} quote invoice ${inv.number} from ${inv.vendorName}, which was billed once.` });
  }

  // 2. Only the vendor is in the memo: a vendor that bills the same amount monthly is normal, so flag only payments beyond the invoices on file.
  const byVendorAmount = new Map<string, { vendor: Invoice[]; hits: BankTx[] }>();
  for (const t of txs.filter((x) => !used.has(x.line))) {
    const candidates = bills.filter((i) => sameAmount(t, i) && vendorInMemo(t, i));
    if (!candidates.length) continue;
    const key = `${normalizeVendor(candidates[0].vendorName)}|${t.amount}`;
    const g = byVendorAmount.get(key) ?? { vendor: candidates, hits: [] };
    g.hits.push(t); byVendorAmount.set(key, g);
  }
  for (const { vendor, hits } of byVendorAmount.values()) {
    const extra = hits.length - vendor.length;
    if (extra <= 0) continue;
    hits.forEach((t) => used.add(t.line));
    out.push({ id: idOf(hits), strength: "medium", alternatives: sameVendor(vendor[0], bills),
      reasons: [`Each payment is ${hits[0].amount}, the same as ${vendor.length} invoice${vendor.length === 1 ? "" : "s"} from ${vendor[0].vendorName}.`, `Descriptions mention the vendor name, but no invoice number.`, `${hits.length} payments against ${vendor.length} invoice${vendor.length === 1 ? "" : "s"} of that amount.`],
      kind: "same-invoice", covered: vendor.length, vendorName: vendor[0].vendorName, invoice: vendor[0], txs: hits, refundable: D(hits[0].amount).times(extra),
      why: `${hits.length} payments of ${hits[0].amount} went to ${vendor[0].vendorName}, but only ${vendor.length} invoice${vendor.length === 1 ? "" : "s"} of that amount ${vendor.length === 1 ? "is" : "are"} on file.` });
  }
  // Same amount and memo again within 7 days, not already explained above.
  const rest = txs.filter((t) => !used.has(t.line));
  const seen = new Set<number>();
  for (const t of rest) {
    if (seen.has(t.line)) continue;
    const twins = rest.filter((u) => !seen.has(u.line) && u.amount === t.amount && normalizeVendor(u.description) === normalizeVendor(t.description) && days(u.date, t.date) <= 7);
    if (twins.length >= 2) {
      twins.forEach((u) => seen.add(u.line));
      out.push({
        id: idOf(twins), strength: "weak",
        reasons: [`Same amount (${t.amount}) and description, ${twins.length} times within 7 days.`, "No invoice on file matches, so this is only a pattern."],
        kind: "repeat-charge", vendorName: t.description.slice(0, 60), txs: twins, refundable: D(t.amount).times(twins.length - 1),
        why: `The same ${t.amount} went to "${t.description.slice(0, 50)}" ${twins.length} times within a week. Fine for a subscription that bills often; worth a look if it should have been one payment.`,
      });
    }
  }
  return out.sort((a, b) => Number(b.refundable) - Number(a.refundable));
}

export interface Corrections {
  dismissed: ReadonlySet<string>;
  /** Transaction lines the user says do not belong to a suggestion. */
  removed: ReadonlySet<number>;
  /** Suggestion id -> invoice the user says it really relates to. */
  relinked: ReadonlyMap<string, string>;
}

/** Applies the user's corrections. A suggestion with fewer than two payments left is no longer a duplicate and drops out; the amount is recomputed. */
export function applyCorrections(dups: DuplicatePayment[], c: Corrections): { shown: DuplicatePayment[]; dismissed: DuplicatePayment[] } {
  const shown: DuplicatePayment[] = [], dismissed: DuplicatePayment[] = [];
  for (const d of dups) {
    if (c.dismissed.has(d.id)) { dismissed.push(d); continue; }
    const txs = d.txs.filter((t) => !c.removed.has(t.line));
    const covered = d.covered ?? 1;
    if (txs.length <= covered) continue;
    const linked = d.alternatives?.find((i) => i.id === c.relinked.get(d.id)) ?? d.invoice;
    shown.push({ ...d, invoice: linked, txs, refundable: D(txs[0].amount).times(txs.length - covered) });
  }
  return { shown, dismissed };
}
