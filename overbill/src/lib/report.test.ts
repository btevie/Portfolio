import { describe, expect, it } from "vitest";
import { createSeedState } from "./data/seed";
import { auditAll } from "./data/selectors";
import { savingsReportHtml } from "./report";

describe("savingsReportHtml", () => {
  const state = createSeedState();
  const audits = auditAll(state);
  it("is a standalone page with the headline figures", () => {
    const html = savingsReportHtml(state, audits, { now: new Date("2026-11-27") });
    expect(html).toContain("<h1>Savings report</h1>");
    expect(html).toContain("27 November 2026");
    expect(html).toContain("Money recovered");
  });
  it("hides vendor names when redacted", () => {
    const vendorName = state.recovery[0]?.vendorName ?? state.vendors[0].name;
    const html = savingsReportHtml(state, audits, { redact: true });
    expect(html).not.toContain(vendorName);
    expect(html).toContain("Vendor 1");
  });
  it("escapes text so a vendor name cannot inject markup", () => {
    const s = createSeedState();
    s.recovery = [{ ...s.recovery[0], vendorName: '<img src=x onerror=alert(1)>', status: "flagged" }];
    expect(savingsReportHtml(s, auditAll(s))).not.toContain("<img src=x");
  });
});
