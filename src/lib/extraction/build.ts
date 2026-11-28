import { normalizeVendor } from "../audit/normalize";
import type { AppState, Invoice, Vendor } from "../types";
import { newId } from "../ids";
import { cleanText } from "./sanitize";
import { MAX_NUMBER_CHARS, MAX_VENDOR_CHARS, type ExtractedInvoice } from "./types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Turns reviewed extraction output into a stored Invoice, matching or creating the vendor. */
export function buildInvoice(e: ExtractedInvoice, state: AppState, createdAt = Date.now()): { invoice: Invoice; newVendor?: Vendor } {
  // The review form can hand back edited text, so sanitize here as well as in the parsers.
  const vendorName = cleanText(e.vendorName, MAX_VENDOR_CHARS);
  const number = cleanText(e.number, MAX_NUMBER_CHARS);
  const key = normalizeVendor(vendorName);
  let vendor = state.vendors.find((v) => normalizeVendor(v.name) === key);
  let newVendor: Vendor | undefined;
  if (!vendor) {
    vendor = newVendor = { id: `v-${slug(vendorName)}-${createdAt.toString(36)}-${newId().slice(0, 6)}`, name: vendorName, category: "Other", billing: "fixed", monitoring: { enabled: true, notify: true } };
  }
  const id = `inv-up-${createdAt.toString(36)}-${newId().slice(0, 8)}`;
  const invoice: Invoice = {
    id, vendorId: vendor.id, vendorName: vendor.name, number, date: e.date, dueDate: e.dueDate, currency: e.currency,
    lineItems: e.lines.map((l, i) => ({ ...l, id: `${id}-l${i + 1}` })),
    subtotal: e.subtotal, discounts: e.discounts, fees: e.fees, taxAmount: e.taxAmount, taxRate: e.taxRate, total: e.total,
    paymentStatus: "unpaid", ...(e.isCredit ? { isCredit: true } : {}), source: "upload", ...(e.medical ? { medical: true } : {}), ...(e.confirmedFields?.length ? { uncertainFields: [...e.confirmedFields] } : {}), ...(e.notes?.length ? { readNotes: e.notes.slice(0, 10).map((n) => cleanText(n, 300)) } : {}), extraction: e.method === "mock-demo" ? "mock" : e.method, createdAt,
  };
  return { invoice, newVendor };
}
