import type { Currency } from "./types";

/** Every ISO 4217 code the runtime knows about (about 160), with the three the demo uses first. */
const PINNED = ["EUR", "USD", "GBP"];
/** Used where `Intl.supportedValuesOf` is missing (older Safari and WebViews), so a saved JPY, CHF or SEK record is never dropped as "unknown". */
const FALLBACK = ["AED", "ARS", "AUD", "BGN", "BHD", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CZK", "DKK", "EGP", "HKD", "HRK", "HUF", "IDR", "ILS", "INR", "ISK", "JOD", "JPY", "KES", "KRW", "KWD", "LKR", "MAD", "MXN", "MYR", "NGN", "NOK", "NZD", "OMR", "PEN", "PHP", "PKR", "PLN", "QAR", "RON", "RSD", "RUB", "SAR", "SEK", "SGD", "THB", "TND", "TRY", "TWD", "UAH", "VND", "ZAR"];
const ALL: string[] = (() => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("currency"); } catch { return FALLBACK; }
})();
export const CURRENCIES: readonly Currency[] = [...PINNED, ...ALL.filter((c) => !PINNED.includes(c))];

const SET = new Set<string>(CURRENCIES);
export const isCurrency = (x: unknown): x is Currency => typeof x === "string" && SET.has(x);

let names: Intl.DisplayNames | null = null;
/** "Japanese Yen" for "JPY"; falls back to the code itself. */
export function currencyName(code: Currency): string {
  try { names ??= new Intl.DisplayNames(["en"], { type: "currency" }); return names.of(code) ?? code; } catch { return code; }
}

/** Currency symbols people actually type in invoices. Ambiguous ones ($, ¥, kr) map to the most common reading. */
export const SYMBOLS: Record<string, Currency> = { "€": "EUR", "$": "USD", "£": "GBP", "¥": "JPY", "₹": "INR", "₩": "KRW", "₺": "TRY", "₽": "RUB", "₪": "ILS", "₫": "VND", "₴": "UAH", "₱": "PHP", "฿": "THB", "zł": "PLN", "Kč": "CZK" };
