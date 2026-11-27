import { describe, expect, it } from "vitest";
import { createSeedState } from "./data/seed";
import { dueDatesCalendar } from "./calendar";

describe("dueDatesCalendar", () => {
  const invoices = createSeedState().invoices;
  const ics = dueDatesCalendar(invoices.map((i) => ({ ...i, paymentStatus: "unpaid" as const })), new Set([invoices[0].id]), new Date("2026-11-27T10:00:00Z"));
  it("is a valid calendar with one all-day event per unpaid invoice", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(invoices.filter((i) => !i.isCredit).length);
    expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
  });
  it("tells flagged invoices apart and skips paid ones", () => {
    expect(ics).toContain("Review before paying: ");
    const paid = dueDatesCalendar(invoices.map((i) => ({ ...i, paymentStatus: "paid" as const })), new Set());
    expect(paid).not.toContain("BEGIN:VEVENT");
  });
  it("escapes commas and semicolons", () => {
    const ev = dueDatesCalendar([{ ...invoices[0], vendorName: "A, B; C", paymentStatus: "unpaid" }], new Set());
    expect(ev).toContain("A\\, B\; C");
  });
});
