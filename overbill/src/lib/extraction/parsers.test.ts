import { describe, expect, it } from "vitest";
import { CSV_TEMPLATE, parseCsv } from "./parsers";

describe("CSV import", () => {
  it("the downloadable template parses cleanly with decimal-string money", () => {
    const r = parseCsv(CSV_TEMPLATE, "EUR");
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1].kind).toBe("fee");
    expect(r.total).toBe("65.34");
    expect(r.vendorName).toBe("Example Telecom");
  });

  it("reports every bad row at once, not just the first", () => {
    const csv = "description,quantity,unit_price\nA,1,10.00\nB,x,5\nC,2,-3\nD,1,4";
    expect(() => parseCsv(csv, "EUR")).toThrow(/Row 3.*Row 4/);
  });
});
