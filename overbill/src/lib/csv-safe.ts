/**
 * CSV cell writer for everything Overbill exports. A cell that starts with = + - @ (or a tab / carriage return) is
 * run as a formula by Excel, Sheets and Numbers, and vendor names and line descriptions come from documents the user
 * did not write. Such cells get a leading apostrophe. Plain numbers (including negatives) are left alone so
 * amounts stay numeric.
 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function safeCsvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (!PLAIN_NUMBER.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const safeCsvRow = (cells: (string | number | null | undefined)[]) => cells.map(safeCsvCell).join(",");
