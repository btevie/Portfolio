import { describe, expect, it } from "vitest";
import { buildNegotiationPlaybook } from "./negotiation-intel";
import { createSeedState } from "./data/seed";

describe("buildNegotiationPlaybook currencies", () => {
  it("never adds amounts in different currencies together", () => {
    const s = createSeedState();
    const vendor = s.vendors.find((v) => v.name.startsWith("Northwind"))!;
    const mine = s.invoices.filter((i) => i.vendorId === vendor.id && !i.isCredit);
    const eur = buildNegotiationPlaybook(vendor, mine, "2026-11-26")!;
    const withUsd = [...mine, { ...mine[0], id: "usd-1", currency: "USD", total: "100000.00", date: "2026-01-01" }];
    const mixed = buildNegotiationPlaybook(vendor, withUsd, "2026-11-26")!;
    expect(mixed.annualizedSpend).toBe(eur.annualizedSpend);
  });
});
