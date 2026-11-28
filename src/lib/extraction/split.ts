const MAX_BILLS = 20;
const SEPARATOR = /^\s*([-=*_~#])\1{2,}\s*$/;
const HEADER = /^\s*(vendor|from|supplier)\s*[:=]/i;

/**
 * Splits one paste holding several bills into one text per bill. Conservative on purpose:
 * it splits only on a divider line (---, ===, ***) or when "Vendor:" / "From:" / "Supplier:" starts a new block twice or more.
 * Anything else stays as one bill, so a single bill is never cut in half.
 */
export function splitBills(text: string): string[] {
  const lines = text.split(/\r?\n/);
  let blocks: string[][] = [[]];
  if (lines.some((l) => SEPARATOR.test(l))) {
    for (const l of lines) { if (SEPARATOR.test(l)) blocks.push([]); else blocks[blocks.length - 1].push(l); }
  } else if (lines.filter((l) => HEADER.test(l)).length >= 2) {
    blocks = [[]];
    for (const l of lines) { if (HEADER.test(l) && blocks[blocks.length - 1].some((x) => HEADER.test(x))) blocks.push([]); blocks[blocks.length - 1].push(l); }
  } else return [text.trim()].filter(Boolean);
  const out = blocks.map((b) => b.join("\n").trim()).filter(Boolean);
  return out.length > 0 && out.length <= MAX_BILLS ? out : [text.trim()].filter(Boolean);
}
