import type { Currency } from "./types";

/** Every ISO 4217 code the runtime knows about (about 160), with the three the demo uses first. */
const PINNED = ["EUR", "USD", "GBP"];
const ALL: string[] = (() => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("currency"); } catch { return []; }
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
