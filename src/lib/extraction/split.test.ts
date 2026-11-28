import { describe, expect, it } from "vitest";
import { splitBills } from "./split";

describe("splitBills", () => {
  it("keeps a single bill whole", () => {
    expect(splitBills("Vendor: A\nTotal: 10")).toEqual(["Vendor: A\nTotal: 10"]);
  });
  it("splits on divider lines", () => {
    expect(splitBills("Vendor: A\nTotal: 10\n---\nVendor: B\nTotal: 20")).toEqual(["Vendor: A\nTotal: 10", "Vendor: B\nTotal: 20"]);
  });
  it("splits when Vendor: starts a block twice", () => {
    expect(splitBills("Vendor: A\nTotal: 10\n\nVendor: B\nTotal: 20")).toEqual(["Vendor: A\nTotal: 10", "Vendor: B\nTotal: 20"]);
  });
  it("ignores empty blocks and a lone text", () => {
    expect(splitBills("---\nA\n---\n---\nB\n---")).toEqual(["A", "B"]);
    expect(splitBills("   ")).toEqual([]);
  });
});
