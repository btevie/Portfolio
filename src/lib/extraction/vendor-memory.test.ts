import { describe, expect, it } from "vitest";
import { applyVendorMemory } from "./vendor-memory";
import { createSeedState } from "../data/seed";
import type { ExtractedInvoice } from "./types";

const base = (over: Partial<ExtractedInvoice>): ExtractedInvoice => ({
  vendorName: "Nobody Ltd", number: "1", date: "2026-03-01", dueDate: "2026-03-01", currency: "USD", lines: [], subtotal: "0", total: "0", lowConfidence: ["currency", "dueDate"], method: "text", ...over,
} as ExtractedInvoice);

describe("applyVendorMemory", () => {
  const state = createSeedState();
  it("leaves unknown vendors untouched", () => {
    const e = base({});
    expect(applyVendorMemory(e, state)).toEqual(e);
  });
  it("fills guessed currency and due date from the vendor's last bill, never what the bill said", () => {
    const last = state.invoices.find((i) => !i.isCredit)!;
    const out = applyVendorMemory(base({ vendorName: last.vendorName, lowConfidence: ["currency", "dueDate"] }), state);
    expect(out.currency).toBe(last.currency);
    expect(out.lowConfidence).not.toContain("currency");
    const said = applyVendorMemory(base({ vendorName: last.vendorName, lowConfidence: [] }), state);
    expect(said.currency).toBe("USD");
  });
});
