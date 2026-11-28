import Decimal from "decimal.js";
import type { Currency } from "../types";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** Parse a decimal string; invalid input becomes 0 (extraction validates before this point). */
export function D(v: Decimal.Value | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  try {
    return new Decimal(v);
  } catch {
    return new Decimal(0);
  }
}

/** Max digits accepted anywhere a user or a document can supply an amount. */
export const MAX_INT_DIGITS = 12;
export const MAX_DECIMAL_DIGITS = 6;

export function isValidDecimal(v: string): boolean {
  return new RegExp(`^-?\\d{1,${MAX_INT_DIGITS}}(\\.\\d{1,${MAX_DECIMAL_DIGITS}})?$`).test(v.trim());
}

export const round2 = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const str2 = (d: Decimal): string => round2(d).toFixed(2);
export const sum = (vals: Decimal[]): Decimal => vals.reduce((a, b) => a.plus(b), new Decimal(0));

const formatters = new Map<string, Intl.NumberFormat>();

/** Rounds to the currency's own number of decimals (0 for JPY, 3 for BHD and KWD), not always 2, so no digit is lost or invented. */
export function formatMoney(amount: Decimal.Value, currency: Currency, opts?: { signed?: boolean }): string {
  let fmt = formatters.get(currency);
  if (!fmt) { fmt = new Intl.NumberFormat("en-IE", { style: "currency", currency }); formatters.set(currency, fmt); }
  const n = D(amount).toDecimalPlaces(fmt.resolvedOptions().maximumFractionDigits).toNumber();
  const s = fmt.format(Math.abs(n));
  if (n < 0) return `-${s}`;
  return opts?.signed && n > 0 ? `+${s}` : s;
}

export function pct(part: Decimal, whole: Decimal): Decimal {
  if (whole.isZero()) return new Decimal(0);
  return part.div(whole).times(100);
}
