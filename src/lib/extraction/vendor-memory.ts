import { normalizeVendor, parseISO } from "../audit/normalize";
import type { AppState } from "../types";
import type { ExtractedInvoice } from "./types";
import { isSimulated } from "../evidence";


/**
 * Fills only what was guessed (currency, due date) from the vendor's most recent bill, so a repeat vendor needs fewer fields confirmed.
 * Anything the bill actually said is never overwritten.
 */
export function applyVendorMemory(e: ExtractedInvoice, state: AppState): ExtractedInvoice {
  const key = normalizeVendor(e.vendorName);
  const last = state.invoices
    .filter((i) => !i.isCredit && !isSimulated(i) && normalizeVendor(i.vendorName) === key)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!last) return e;
  let out = { ...e };
  const guessed = new Set(e.lowConfidence);
  if (guessed.has("currency") && last.currency) { out = { ...out, currency: last.currency }; guessed.delete("currency"); }
  if (guessed.has("dueDate")) {
    const prior = parseISO(last.date), priorDue = parseISO(last.dueDate), date = parseISO(e.date);
    if (prior !== null && priorDue !== null && date !== null && priorDue >= prior) {
      out = { ...out, dueDate: new Date(date + (priorDue - prior)).toISOString().slice(0, 10) };
      guessed.delete("dueDate");
    }
  }
  return { ...out, lowConfidence: [...guessed] };
}
