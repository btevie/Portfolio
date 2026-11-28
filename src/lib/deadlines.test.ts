import { describe, expect, it } from "vitest";
import { buildIcs, upcomingDeadlines } from "./deadlines";
import { createSeedState } from "./data/seed";
import { auditAll } from "./data/selectors";

describe("calendar deadlines", () => {
  it("builds a valid, escaped, CRLF-terminated calendar with 9:00 alarms", () => {
    const ics = buildIcs([{ uid: "a", date: "2026-12-01", title: "Decide: Acme, Inc; renewal", note: "line1\nline2" }], new Date("2026-11-28T10:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const flat = ics.replace(/\r\n /g, "");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261201");
    expect(ics).toContain("DTEND;VALUE=DATE:20261202");
    expect(flat).toContain("SUMMARY:Decide: Acme\\, Inc\\; renewal");
    expect(flat).toContain("DESCRIPTION:line1\\nline2");
    expect(ics).toContain("TRIGGER:-PT15H");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it("only lists future dates, sorted, from real state", () => {
    const state = createSeedState();
    const d = upcomingDeadlines(state, auditAll(state), Date.parse("2026-01-01"));
    expect(d.map((x) => x.date)).toEqual([...d.map((x) => x.date)].sort());
    expect(upcomingDeadlines(state, auditAll(state), Date.parse("2100-01-01"))).toEqual([]);
  });
});
