/**
 * Credit notes. The vendor owes the customer money, so every amount on the document is naturally positive (or shown
 * negative). Overbill keeps them positive and flags the invoice `isCredit`: it is tracked, never audited as a bill.
 */
const TYPE_LINE = /^\s*(?:document\s*type|type)\s*[:=]\s*credit[\s_-]*(?:note|memo)\b/im;
const HEADING = /^\s*(?:credit[\s_-]*(?:note|memo)|credit\s*invoice)\s*$/im;

/** Quote-aware records, so a quoted cell containing a line break doesn't split a row. */
function csvRecords(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quoted && c === '"' && content[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === delimiter) { row.push(cell.trim()); cell = ""; }
    else if (!quoted && (c === "\n" || c === "\r")) { if (c === "\r" && content[i + 1] === "\n") i++; row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell.trim()); rows.push(row);
  return rows;
}

function isCreditCsv(text: string): boolean {
  const content = text.replace(/^\uFEFF/, "");
  const header = content.split(/\r?\n/, 1)[0];
  const delimiter = [",", ";", "\t"].sort((a, b) => header.split(b).length - header.split(a).length)[0];
  const [names, ...rows] = csvRecords(content, delimiter).map((r) => r.map((x) => x.toLowerCase().replace(/[\s-]+/g, "_")));
  const typeIndex = (names ?? []).findIndex((x) => ["type", "document_type", "invoice_type", "transaction_type", "document_kind"].includes(x));
  if (typeIndex < 0) return false;
  return rows.some((row) => /^credit[_]*(?:note|memo)$/i.test(row[typeIndex] ?? ""));
}

/** The CSV's type column, when it has one: the column is authoritative, so heading-like text inside a cell can't override it. */
function csvTypeColumn(text: string): { present: boolean; credit: boolean } {
  const content = text.replace(/^\uFEFF/, "");
  const header = content.split(/\r?\n/, 1)[0];
  const delimiter = [",", ";", "\t"].sort((a, b) => header.split(b).length - header.split(a).length)[0];
  const names = (csvRecords(content, delimiter)[0] ?? []).map((x) => x.toLowerCase().replace(/[\s-]+/g, "_"));
  // A real CSV table has more than one column; a lone "Type" line in plain text is just a label.
  const present = names.length >= 2 && names.some((x) => ["type", "document_type", "invoice_type", "transaction_type", "document_kind"].includes(x));
  return { present, credit: present && isCreditCsv(text) };
}

export function isCreditDocument(text: string): boolean {
  const column = csvTypeColumn(text);
  if (column.present) return column.credit;
  // Without a type column, a quoted cell ("Service\nCredit note\nhandling") is still data, not a heading.
  // Only a real field quote counts (right after a delimiter or line start, right before one), so inch marks in ordinary text ('12" Displays') never hide a heading.
  const outsideQuotes = text.includes('"') ? text.replace(/(^|[,;\t\r\n])"(?:[^"]|"")*"(?=[,;\t\r\n]|$)/g, '$1""') : text;
  return TYPE_LINE.test(outsideQuotes) || HEADING.test(outsideQuotes);
}

/**
 * Layout reshaping can drop a "Credit invoice" heading. If the original text said it was a credit note but the reshaped text
 * no longer does, say so explicitly, so the document is never audited as an ordinary bill.
 */
export function keepCreditSignal(original: string, reshaped: string): string {
  return isCreditDocument(original) && !isCreditDocument(reshaped) ? `Document type: Credit note\n${reshaped}` : reshaped;
}

/** "-12.50", "(12.50)" and "−12.50" all become "12.50". */
export function absoluteAmounts(text: string): string {
  return text
    .replace(/[−–](?=\s*(?:\p{Sc}\s*)?\d)\s*/gu, "-")
    // A minus just inside the opening quote of a quoted CSV cell: "-12.50"
    .replace(/(^|[\s|;,\t])"\s*-(?=\s*(?:\p{Sc}\s*)?\d)\s*/gmu, '$1"')
    .replace(/(^|[\s|;,:=\t])-(?=\s*(?:\p{Sc}\s*)?\d)\s*/gu, "$1")
    // Spaces are allowed inside the number only when more digits follow, so they can't also be matched before ")" (no quadratic backtracking).
    .replace(/\(\s*(?:[-−–]\s*)?((?:\p{Sc}\s*)?\d(?:[\d.,]|[ \t](?=[\d.,]))*)\s*\)/gu, "$1");
}
