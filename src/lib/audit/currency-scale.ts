/**
 * Rough size of one unit of a currency compared with one euro, ONLY for amount thresholds in the checks ("high severity
 * from 100 up", "ignore differences under 5"). It is not an exchange rate and never converts or compares amounts across
 * currencies. Currencies whose unit is worth about as much as a euro (EUR, USD, GBP, CHF...) are left at 1, so their
 * thresholds do not change. Without this, 20 yen counted like 20 euro.
 */
const UNITS_PER_EURO: Record<string, number> = {
  JPY: 150, KRW: 1500, VND: 27000, IDR: 17000, CLP: 1000, ISK: 150, HUF: 400, INR: 90, PKR: 300, KES: 140, NGN: 1700,
  TWD: 35, PHP: 60, THB: 38, CZK: 25, RUB: 100, UAH: 45, ARS: 1000, CRC: 550, COP: 4500, PYG: 8000, UGX: 4000, TZS: 2700, XOF: 656, XAF: 656,
  KWD: 0.33, BHD: 0.4, OMR: 0.42, JOD: 0.77,
};

export const unitsPerEuro = (currency: string): number => UNITS_PER_EURO[currency] ?? 1;

/** A threshold written for euros, as a plain number in `currency`. */
export const scaled = (euros: number, currency: string): number => euros * unitsPerEuro(currency);
