import { normalizeVendor } from "../audit/normalize";
import type { AppState, Invoice, Vendor } from "../types";
import type { ExtractedInvoice } from "./types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Turns reviewed extraction output into a stored Invoice, matching or creating the vendor. */
export function buildInvoice(e: ExtractedInvoice, state: AppState, createdAt = Date.now()): { invoice: Invoice; newVendor?: Vendor } {
  const key = normalizeVendor(e.vendorName);
  let vendor = state.vendors.find((v) => normalizeVendor(v.name) === key);
  let newVendor: Vendor | undefined;
  if (!vendor) {
    vendor = newVendor = { id: `v-${slug(e.vendorName)}-${createdAt.toString(36)}`, name: e.vendorName.trim(), category: "Other", billing: "fixed", monitoring: { enabled: true, notify: true } };
  }
  const id = `inv-up-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const invoice: Invoice = {
    id, vendorId: vendor.id, vendorName: vendor.name, number: e.number.trim(), date: e.date, dueDate: e.dueDate, currency: e.currency,
    lineItems: e.lines.map((l, i) => ({ ...l, id: `${id}-l${i + 1}` })),
    subtotal: e.subtotal, discounts: e.discounts, fees: e.fees, taxAmount: e.taxAmount, taxRate: e.taxRate, total: e.total,
    paymentStatus: "unpaid", source: "upload", createdAt,
  };
  return { invoice, newVendor };
}
