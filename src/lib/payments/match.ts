import { D, Decimal } from "../audit/money";
import { normalizeInvoiceNumber, normalizeVendor, parseISO } from "../audit/normalize";
import type { Invoice } from "../types";

export interface BankTx { date: string; description: string; amount: string; line: number }
export interface DuplicatePayment {
  kind: "same-invoice" | "repeat-charge";
  vendorName: string;
  invoice?: Invoice;
  txs: BankTx[];
  /** Money paid more than once: (payments − 1) × amount. */
  refundable: Decimal;
  why: string;
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

/** Reads a bank or card statement CSV. Only money going out is kept. Returns what it could not read too. */
export function parseStatement(text: string): { txs: BankTx[]; skipped: number; error?: string } {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows = splitRows(text, delimiter);
  if (rows.length < 2) return { txs: [], skipped: 0, error: "The file needs a header row and at least one transaction." };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const dateI = find(/date|datum|fecha|data\b/);
  const descIs = head.map((h, i) => (/(description|details|memo|narrative|reference|payee|merchant|name|particulars|omschrijving|beschrijving|verwendungszweck|buchungstext|libell|concepto|descripci)/.test(h) ? i : -1)).filter((i) => i >= 0);
  const amountI = find(/^(amount|value|sum)\b|\bamount\b/);
  const outI = find(/(debit|d[eé]bit|withdrawal|paid out|money out|outgoing|soll|af\b)/);
  if (dateI < 0 || !descIs.length || (amountI < 0 && outI < 0)) return { txs: [], skipped: 0, error: "Couldn't find the date, description and amount columns. Export your statement as CSV with headers such as Date, Description and Amount." };
  const parsed = rows.slice(1).map((r, k) => ({ r, line: k + 2 }));
  const signed = amountI >= 0 ? parsed.map(({ r }) => toAmount(r[amountI])).filter((a): a is string => a !== null) : [];
  const anyNegative = signed.some((a) => a.startsWith("-"));
  const txs: BankTx[] = []; let skipped = 0;
  for (const { r, line } of parsed) {
    const date = toDate(r[dateI]);
    const description = descIs.map((i) => r[i]?.trim()).filter(Boolean).join(" ").slice(0, 200);
    let out: string | null = null;
    let incoming = false;
    if (outI >= 0 && toAmount(r[outI]) !== null) out = toAmount(r[outI])!.replace("-", "");
    else if (amountI >= 0) {
      const a = toAmount(r[amountI]);
      if (a !== null) { if (anyNegative && !a.startsWith("-")) incoming = true; else out = anyNegative ? a.slice(1) : a; }
    }
    if (incoming) continue; // money coming in is not a payment, and is not an unreadable row
    if (!date || !description || out === null) { if (r.some((c) => c.trim())) skipped++; continue; }
    if (D(out).gt(0)) txs.push({ date, description, amount: D(out).toFixed(2), line });
  }
  return { txs, skipped };
}

const days = (a: string, b: string) => Math.abs(((parseISO(a) ?? 0) - (parseISO(b) ?? 0)) / 86_400_000);
const words = (s: string) => normalizeVendor(s).split(/\s+/).filter((w) => w.length >= 4);

const sameAmount = (tx: BankTx, inv: Invoice) => D(tx.amount).eq(D(inv.total));
const numberInMemo = (tx: BankTx, inv: Invoice) => { const n = normalizeInvoiceNumber(inv.number); return n.length >= 3 && normalizeInvoiceNumber(tx.description).includes(n); };
const vendorInMemo = (tx: BankTx, inv: Invoice) => { const memo = normalizeVendor(tx.description); return words(inv.vendorName).some((w) => memo.includes(w)); };

/** Money paid twice. Matching is deliberately conservative and always shows its reasoning; the user decides. */
export function findDuplicatePayments(txs: BankTx[], invoices: Invoice[]): DuplicatePayment[] {
  const bills = invoices.filter((i) => !i.isCredit);
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
    out.push({ kind: "same-invoice", vendorName: inv.vendorName, invoice: inv, txs: hits, refundable: D(inv.total).times(hits.length - 1),
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
    out.push({ kind: "same-invoice", vendorName: vendor[0].vendorName, invoice: vendor[0], txs: hits, refundable: D(hits[0].amount).times(extra),
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
        kind: "repeat-charge", vendorName: t.description.slice(0, 60), txs: twins, refundable: D(t.amount).times(twins.length - 1),
        why: `The same ${t.amount} went to "${t.description.slice(0, 50)}" ${twins.length} times within a week. Fine for a subscription that bills often; worth a look if it should have been one payment.`,
      });
    }
  }
  return out.sort((a, b) => Number(b.refundable) - Number(a.refundable));
}
