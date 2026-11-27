import { describe, expect, it } from "vitest";
import { safeCsvCell } from "./csv-safe";
import { decryptBackup, encryptBackup, isEncryptedBackup } from "./crypto-backup";
import { recurringSignals } from "./recurring-watch";
import { buildManifest, findingsCsv, sha256Hex } from "./export-pack";
import { auditAll } from "./data/selectors";
import { createSeedState } from "./data/seed";
import type { Invoice } from "./types";

const bill = (n: number, date: string, total: string, over: Partial<Invoice> = {}): Invoice => ({
  id: `i${n}`, vendorId: "v1", vendorName: "Acme", number: `A-${n}`, date, dueDate: date, currency: "EUR", lineItems: [],
  subtotal: total, discounts: "0.00", fees: "0.00", taxAmount: "0.00", total, paymentStatus: "paid", source: "upload", extraction: "csv", createdAt: n, ...over,
});

describe("csv-safe", () => {
  it("neutralises formulas but keeps numbers and quotes cells", () => {
    expect(safeCsvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(safeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeCsvCell("-12.50")).toBe("-12.50");
    expect(safeCsvCell("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0");
    expect(safeCsvCell("a,b")).toBe("\"a,b\"");
  });
});

describe("encrypted backup", () => {
  it("round-trips, and refuses a wrong passphrase", async () => {
    const enc = await encryptBackup("{\"hello\":1}", "correct horse");
    expect(isEncryptedBackup(enc)).toBe(true);
    expect(enc).not.toContain("hello");
    expect(await decryptBackup(enc, "correct horse")).toBe("{\"hello\":1}");
    expect(await decryptBackup(enc, "wrong")).toBeNull();
    expect(isEncryptedBackup("{\"version\":1}")).toBe(false);
  });
});

describe("recurring watch", () => {
  const monthly = [bill(1, "2026-05-01", "100.00"), bill(2, "2026-05-31", "100.00"), bill(3, "2026-07-01", "100.00"), bill(4, "2026-07-31", "100.00")];
  it("flags a bill that is missing, and says nothing when it is on time", () => {
    expect(recurringSignals(monthly, "2026-08-10").some((s) => s.kind === "missing")).toBe(false);
    const late = recurringSignals(monthly, "2026-09-20").find((s) => s.kind === "missing");
    expect(late?.headline).toMatch(/days past/);
  });
  it("flags cumulative creep against the first bill", () => {
    const s = recurringSignals([bill(1, "2026-05-01", "100.00"), bill(2, "2026-05-31", "103.00"), bill(3, "2026-07-01", "106.00"), bill(4, "2026-07-31", "109.00")], "2026-08-05");
    expect(s.find((x) => x.kind === "creep")?.headline).toContain("9.0%");
  });
  it("flags two bills close together, ignores credit notes and simulated bills, and keeps currencies apart", () => {
    const dbl = [...monthly, bill(5, "2026-08-03", "100.00")];
    expect(recurringSignals(dbl, "2026-08-10").some((s) => s.kind === "double")).toBe(true);
    expect(recurringSignals(monthly.map((b) => ({ ...b, extraction: "mock" as const })), "2026-09-20")).toEqual([]);
    expect(recurringSignals(monthly.map((b, i) => ({ ...b, currency: i % 2 ? "USD" : "EUR" })), "2026-09-20")).toEqual([]);
    expect(recurringSignals(monthly.map((b) => ({ ...b, isCredit: true })), "2026-09-20")).toEqual([]);
  });
});

describe("export pack", () => {
  it("writes one row per real finding and a manifest hash that matches the file", async () => {
    const state = createSeedState();
    const { csv, rows } = findingsCsv(state, auditAll(state));
    expect(csv.split("\n")[0]).toContain("possible_overcharge_not_confirmed");
    expect(rows).toBe(csv.trim().split("\n").length - 1);
    const manifest = JSON.parse(await buildManifest(csv, rows, new Date("2026-11-28T00:00:00Z")));
    expect(manifest.sha256).toBe(await sha256Hex(csv));
    expect(manifest.note).toMatch(/not confirmed errors/);
  });
});
