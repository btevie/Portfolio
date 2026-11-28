import { describe, expect, it } from "vitest";
import { absoluteAmounts, isCreditDocument } from "./credit";

describe("absoluteAmounts", () => {
  it("still strips minus signs, spaced minus signs and brackets", () => {
    expect(absoluteAmounts("Hosting | 1 | -10.00 | -10.00")).toBe("Hosting | 1 | 10.00 | 10.00");
    expect(absoluteAmounts("Total: - €12.50")).toBe("Total: €12.50");
    expect(absoluteAmounts("Refund (12.50)")).toBe("Refund 12.50");
    expect(absoluteAmounts('a,"-12.50",b')).toBe('a,"12.50",b');
    expect(absoluteAmounts("Total: −10.00")).toBe("Total: 10.00");
  });
  it("does not stall on a long run of spaces after a minus that is not followed by a number", () => {
    const attack = `x,"-${" ".repeat(60_000)}x"`;
    const started = Date.now();
    absoluteAmounts(attack);
    absoluteAmounts(`Total: -${" ".repeat(60_000)}x`);
    expect(Date.now() - started).toBeLessThan(1500);
  });
  it("still recognises a credit heading next to inch marks in ordinary text", () => {
    expect(isCreditDocument('Vendor: 12" Displays\nCredit note\nPanel 24" | 1 | -10.00 | -10.00')).toBe(true);
  });
});
