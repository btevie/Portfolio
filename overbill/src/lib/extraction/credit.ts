/**
 * Credit notes. The vendor owes the customer money, so every amount on the document is naturally positive (or shown
 * negative). Overbill keeps them positive and flags the invoice `isCredit`: it is tracked, never audited as a bill.
 */
const TYPE_LINE = /^\s*(?:document\s*type|type)\s*[:=]\s*credit[\s_-]*(?:note|memo)\b/im;
const HEADING = /^\s*(?:credit[\s_-]*(?:note|memo)|credit\s*invoice)\s*$/im;

function csvCells(row: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (quoted && c === '"' && row[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === delimiter) { cells.push(cell.trim()); cell = ""; }
    else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

function isCreditCsv(text: string): boolean {
  const content = text.replace(/^\uFEFF/, "");
  const header = content.split(/\r?\n/, 1)[0];
  const delimiter = [",", ";", "\t"].sort((a, b) => header.split(b).length - header.split(a).length)[0];
  const names = csvCells(header, delimiter).map((x) => x.toLowerCase().replace(/[\s-]+/g, "_"));
  const typeIndex = names.findIndex((x) => ["type", "document_type", "invoice_type", "transaction_type", "document_kind"].includes(x));
  if (typeIndex < 0) return false;
  return content.split(/\r?\n/).slice(1).some((row) => /^credit[\s_-]*(?:note|memo)$/i.test(csvCells(row, delimiter)[typeIndex] ?? ""));
}

export function isCreditDocument(text: string): boolean {
  return TYPE_LINE.test(text) || HEADING.test(text) || isCreditCsv(text);
}

/** "-12.50", "(12.50)" and "−12.50" all become "12.50". */
export function absoluteAmounts(text: string): string {
  return text
    .replace(/[−–]\s*(?=[\p{Sc}]?\s*\d)/gu, "-")
    .replace(/(^|[\s|;,:=\t])-\s*(?=[\p{Sc}]?\s*\d)/gu, "$1")
    .replace(/\(\s*[-−–]?\s*([\p{Sc}]?\s*\d[\d.,\s]*\d?)\s*\)/gu, "$1");
}
