import { describe, expect, it } from "vitest";
import type { Invoice } from "../types";
import { paymentGuardFindings } from "./payment-guard";
import { DEFAULT_CONFIG } from "./types";

const NL = "NL91ABNA0417164300";
const DE = "DE89370400440532013000";

const inv = (n: number, iban: string): Invoice => ({
  id: `i${n}`, vendorId: "v", vendorName: "Acme", number: `A-${n}`, date: `2026-0${n}-01`, dueDate: `2026-0${n}-28`, currency: "EUR",
  lineItems: [{ id: `l${n}`, description: `Pay to ${iban}`, quantity: "1", unitPrice: "100.00", total: "100.00", kind: "item" }],
  subtotal: "100.00", discounts: "0.00", fees: "0.00", taxAmount: "0.00", total: "100.00", paymentStatus: "unpaid", source: "upload", createdAt: n,
});
const swaps = (all: Invoice[], target: Invoice) => paymentGuardFindings(target, { today: "2026-11-26", invoices: all, contractRates: [], config: DEFAULT_CONFIG }).filter((f) => f.id.includes("iban-swap"));

describe("bank account change warning", () => {
  it("warns on the first invoice with a new account, and again on the next until the account has been used twice", () => {
    const all = [inv(1, NL), inv(2, NL), inv(3, DE), inv(4, DE), inv(5, DE), inv(6, DE)];
    expect(swaps(all, all[2])).toHaveLength(1); // DE first appears: a change
    expect(swaps(all, all[3])).toHaveLength(1); // DE seen once before: still unconfirmed, not "known" yet
    expect(swaps(all, all[4])).toHaveLength(0); // used on two earlier invoices
  });
  it("does not warn when the vendor always used the same account", () => {
    const all = [inv(1, NL), inv(2, NL), inv(3, NL)];
    expect(swaps(all, all[2])).toHaveLength(0);
  });
});
