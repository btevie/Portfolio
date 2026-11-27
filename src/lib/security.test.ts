import { describe, expect, it } from "vitest";
import { auditInvoice } from "./audit/engine";
import { compareToHistory } from "./audit/history";
import { isValidDecimal } from "./audit/money";
import { normalizeDescription, normalizeInvoiceNumber, normalizeVendor } from "./audit/normalize";
import { DEFAULT_CONFIG } from "./audit/types";
import { createSeedState } from "./data/seed";
import { auditAll, vendorStats } from "./data/selectors";
import { parseStoredState } from "./data/validate-state";
import { draftNote } from "./dispute";
import { buildInvoice } from "./extraction/build";
import { mockExtract } from "./extraction/mock";
import { parseCsv, parseText } from "./extraction/parsers";
import { cleanText } from "./extraction/sanitize";
import { MAX_LINES } from "./extraction/types";
import { checkSignature, validateFile } from "./extraction/validate";
import type { Invoice } from "./types";

const dispute = (name: string) => draftNote(createSeedState().invoices.find((i) => i.id === "inv-orbit-resend")!, [], {}, name);
const ascii = (s: string) => new TextEncoder().encode(s);
const ctx = (invoices: Invoice[]) => ({ today: "2026-11-26", invoices, contractRates: [], vendor: undefined, config: DEFAULT_CONFIG });
const textInvoice = (vendor: string, num = "A1") => `Vendor: ${vendor}\nInvoice #: ${num}\nInvoice date: 2026-11-01\nDue date: 2026-12-01\nItem | 1 | 10.00 | 10.00\nTotal: 12.10\nTax: 2.10\nTax rate: 21%`;

describe("M2 identity keys never collapse for non-Latin text", () => {
  it("distinct non-Latin vendors keep distinct keys", () => {
    expect(normalizeVendor("株式会社アルファ")).not.toBe("");
    expect(normalizeVendor("株式会社アルファ")).not.toBe(normalizeVendor("株式会社ベータ"));
    expect(normalizeVendor("Фирма Бета")).not.toBe(normalizeVendor("Фирма Гамма"));
  });
  it("Latin behaviour is unchanged, and compatibility forms fold together", () => {
    expect(normalizeVendor("Acme, Ltd.")).toBe("acme");
    expect(normalizeVendor("Acme B.V.")).toBe(normalizeVendor("Acme BV"));
    expect(normalizeVendor("ＡＣＭＥ")).toBe("acme");
  });
  it("distinct non-Latin invoice numbers and descriptions do not collide", () => {
    expect(normalizeInvoiceNumber("請求書-001")).not.toBe(normalizeInvoiceNumber("領収書-002"));
    expect(normalizeInvoiceNumber("INV-0042")).toBe("42");
    expect(normalizeDescription("月額料金")).not.toBe(normalizeDescription("管理手数料"));
  });
  it("two unrelated non-Latin vendors are not merged by buildInvoice", () => {
    const s = createSeedState();
    const a = buildInvoice(parseText(textInvoice("株式会社アルファ"), "EUR"), s, 1);
    s.vendors.push(a.newVendor!); s.invoices.push(a.invoice);
    const b = buildInvoice(parseText(textInvoice("株式会社ベータ"), "EUR"), s, 2);
    expect(b.newVendor).toBeDefined();
    expect(b.invoice.vendorId).not.toBe(a.invoice.vendorId);
  });
  it("same number and total from different non-Latin vendors is not an exact duplicate", () => {
    const s = createSeedState();
    const a = buildInvoice(parseText(textInvoice("株式会社アルファ"), "EUR"), s, 1);
    s.vendors.push(a.newVendor!); s.invoices.push(a.invoice);
    const b = buildInvoice(parseText(textInvoice("株式会社ベータ"), "EUR"), s, 2);
    s.invoices.push(b.invoice);
    const r = auditInvoice(b.invoice, ctx(s.invoices));
    expect(r.findings.filter((f) => f.ruleId === "duplicate_invoice")).toEqual([]);
  });
});

describe("M3 amounts are never compared across currencies", () => {
  const s = createSeedState();
  const base = s.invoices.find((i) => i.id === "inv-northwind-7")!;
  const usd: Invoice = { ...base, id: "x-usd", number: "ZZ-1", currency: "USD", createdAt: 9e12, date: "2026-11-20", dueDate: "2026-12-20" };
  it("a USD invoice has no EUR baseline", () => {
    const c = compareToHistory(usd, ctx([...s.invoices, usd]));
    expect(c.sampleSize).toBe(0);
    expect(c.reliable).toBe(false);
    expect(c.previous).toBeNull();
  });
  it("vendor statistics use only the latest invoice's currency", () => {
    const state = { ...s, invoices: [...s.invoices, usd] };
    const v = vendorStats(state, auditAll(state)).find((x) => x.vendor.id === "v-northwind")!;
    expect(v.latest?.currency).toBe("USD");
    expect(v.otherCurrencyInvoices).toBe(7);
    expect(v.changePct).toBeNull();
    expect(v.unique.every((i) => i.currency === "USD")).toBe(true);
  });
});

describe("L1 stored state is untrusted input", () => {
  const seed = createSeedState();
  const raw = (o: unknown) => JSON.stringify(o);
  it("round-trips valid state without dropping anything", () => {
    const r = parseStoredState(raw(seed))!;
    expect(r.dropped).toBe(0);
    expect(r.state.invoices.length).toBe(seed.invoices.length);
  });
  it.each([["not json"], ["null"], ["[]"], [raw({ version: 2 })], [raw({ version: 1 })], [raw({ version: 1, invoices: "x", vendors: [], contractRates: [], recovery: [] })]])("unusable top level %# is rejected", (x) => {
    expect(parseStoredState(x)).toBeNull();
  });
  it("drops malformed records individually and counts them", () => {
    const bad = { ...seed, invoices: [seed.invoices[0], { id: "x" }, { ...seed.invoices[1], total: "abc" }, { ...seed.invoices[2], currency: "XXX" }] };
    const r = parseStoredState(raw(bad))!;
    expect(r.state.invoices.map((i) => i.id)).toEqual([seed.invoices[0].id]);
    expect(r.dropped).toBe(3);
  });
  it("rejects oversized amounts and absurd line counts", () => {
    const huge = { ...seed.invoices[0], total: "9".repeat(40) };
    const many = { ...seed.invoices[1], lineItems: Array.from({ length: MAX_LINES + 1 }, () => seed.invoices[1].lineItems[0]) };
    expect(parseStoredState(raw({ ...seed, invoices: [huge, many] }))!.state.invoices).toEqual([]);
  });
  it("falls back to default settings and ignores invalid decisions, including __proto__ keys", () => {
    const r = parseStoredState(`{"version":1,"vendors":[],"invoices":[],"contractRates":[],"recovery":[],"settings":{"currency":"BTC"},"decisions":{"__proto__":"confirmed","a":"hacked","b":"dismissed"}}`)!;
    expect(r.state.settings.currency).toBe("EUR");
    expect(r.state.decisions).toEqual({ b: "dismissed" });
    expect(({} as Record<string, unknown>).confirmed).toBeUndefined();
  });
  it("never trusts a stored 'keep uploaded files' flag", () => {
    const r = parseStoredState(raw({ ...seed, settings: { ...seed.settings, privacy: { keepUploadedFiles: true, analytics: true } } }))!;
    expect(r.state.settings.privacy.keepUploadedFiles).toBe(false);
  });
});

describe("L2 input is bounded", () => {
  it("amounts are limited to 12 integer and 6 decimal digits", () => {
    expect(isValidDecimal("123456789012.123456")).toBe(true);
    expect(isValidDecimal("1234567890123")).toBe(false);
    expect(isValidDecimal("1.1234567")).toBe(false);
    expect(isValidDecimal("9".repeat(40000))).toBe(false);
  });
  it("pasted text rejects giant numbers and negatives instead of storing them", () => {
    expect(() => parseText(`Vendor: V\nItem | 1 | ${"9".repeat(40)} | 1`, "EUR")).toThrow(/Couldn't read the line/);
    expect(() => parseText(`Vendor: V\nItem | -5 | 10.00 | -50.00`, "EUR")).toThrow(/Couldn't read the line/);
  });
  it("CSV rejects more than MAX_LINES rows, giant numbers and negatives", () => {
    const rows = (n: number) => "description,quantity,unit_price\n" + Array.from({ length: n }, () => "Item,1,1.00").join("\n");
    expect(() => parseCsv(rows(MAX_LINES + 1), "EUR")).toThrow(/more than 500/);
    expect(parseCsv(rows(MAX_LINES), "EUR").lines).toHaveLength(MAX_LINES);
    expect(() => parseCsv(`description,quantity,unit_price\nX,1,${"9".repeat(40)}`, "EUR")).toThrow(/non-negative/);
    expect(() => parseCsv("description,quantity,unit_price\nX,-1,5", "EUR")).toThrow(/non-negative/);
  });
  it("text lines beyond the cap are refused", () => {
    const body = Array.from({ length: MAX_LINES + 1 }, () => "Item | 1 | 1.00 | 1.00").join("\n");
    expect(() => parseText(`Vendor: V\n${body}`, "EUR")).toThrow(/More than 500/);
  });
});

describe("L3 invisible and bidi control characters are stripped", () => {
  it("cleanText removes bidi overrides, zero-width and control characters and caps length", () => {
    expect(cleanText("Acme‮gnirts​\u0007 Ltd", 50)).toBe("Acme gnirts Ltd");
    expect(cleanText("x".repeat(500), 10)).toHaveLength(10);
  });
  it("applies to parsed vendor, number and descriptions, and to edited review-form values", () => {
    const e = parseText(`Vendor: Ac‮me\nInvoice #: 1⁦\nInvoice date: 2026-11-01\nDue date: 2026-12-01\nI​tem | 1 | 1 | 1`, "EUR");
    expect(e.vendorName).toBe("Ac me");
    expect(e.lines[0].description).toBe("I tem");
    const built = buildInvoice({ ...e, vendorName: "Ev‮il", number: "9‎" }, createSeedState(), 5);
    expect(built.invoice.vendorName).toBe("Ev il");
    expect(built.invoice.number).toBe("9");
  });
});

describe("L4 files are checked by content, not just by name", () => {
  it("accepts genuine signatures", () => {
    expect(checkSignature("a.pdf", ascii("%PDF-1.7\n"))).toBeNull();
    expect(checkSignature("a.pdf", ascii("junk\n%PDF-1.4"))).toBeNull();
    expect(checkSignature("a.png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBeNull();
    expect(checkSignature("a.jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(checkSignature("a.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(checkSignature("a.webp", ascii("RIFF\0\0\0\0WEBPVP8 "))).toBeNull();
    expect(checkSignature("a.csv", ascii("description,quantity\n"))).toBeNull();
  });
  it("rejects renamed or disguised files", () => {
    expect(checkSignature("evil.pdf", ascii("<html><script>alert(1)</script>"))).toMatch(/contents don't match/);
    expect(checkSignature("evil.png", ascii("%PDF-1.4"))).toMatch(/contents don't match/);
    expect(checkSignature("evil.jpg", Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toMatch(/contents don't match/);
    expect(checkSignature("evil.webp", ascii("RIFF....WAVE"))).toMatch(/contents don't match/);
    expect(checkSignature("evil.csv", Uint8Array.from([0x4d, 0x5a, 0x00, 0x03]))).toMatch(/contents don't match/);
  });
  it("PDF and image types are refused when mock extraction is switched off; CSV stays allowed", () => {
    const pdf = { name: "a.pdf", type: "application/pdf", size: 10 };
    expect(validateFile(pdf, { mock: true })).toBeNull();
    expect(validateFile(pdf, { mock: false })).toMatch(/isn't available in this build/);
    expect(validateFile({ name: "a.csv", type: "text/csv", size: 10 }, { mock: false })).toBeNull();
  });
});

describe("M1 simulated extraction is recorded, never passed off as a real read", () => {
  it("mock output is marked 'mock' on the stored invoice", () => {
    const built = buildInvoice(mockExtract("real-invoice.pdf", 1), createSeedState(), 7);
    expect(built.invoice.extraction).toBe("mock");
    expect(built.invoice.source).toBe("upload");
  });
  it("CSV and text parsing are marked with their real method", () => {
    const s = createSeedState();
    expect(buildInvoice(parseText(textInvoice("Acme"), "EUR"), s, 8).invoice.extraction).toBe("text");
    expect(buildInvoice(parseCsv("description,quantity,unit_price\nA,1,1", "EUR"), s, 9).invoice.extraction).toBe("csv");
  });
  it("the mock flag survives validation of stored state", () => {
    const s = createSeedState();
    s.invoices.push(buildInvoice(mockExtract("x.pdf", 2), s, 10).invoice);
    const r = parseStoredState(JSON.stringify(s))!;
    expect(r.state.invoices.at(-1)?.extraction).toBe("mock");
  });
});

describe("profile handling", () => {
  it("dispute notes never sign with a blank name", () => {
    expect(dispute("")).toContain("[Your name]");
    expect(dispute("Sam")).toMatch(/Sam$/);
  });
});

describe("hardening: restored data and images", () => {
  it("rejects negative amounts, repeated ids and over-large lists", async () => {
    const { parseStoredState, MAX_RECORDS } = await import("./data/validate-state");
    const { createSeedState } = await import("./data/seed");
    const s = createSeedState();
    const neg = { ...s, recovery: [{ ...s.recovery[0], id: "n1", amount: "-50.00" }, ...s.recovery] };
    expect(parseStoredState(JSON.stringify(neg))!.state.recovery.some((r) => r.id === "n1")).toBe(false);
    const dup = { ...s, invoices: [...s.invoices, s.invoices[0]] };
    expect(parseStoredState(JSON.stringify(dup))!.state.invoices.length).toBe(s.invoices.length);
    expect(MAX_RECORDS.invoices).toBeGreaterThan(0);
  });
  it("reads pixel size from a PNG header and refuses absurd sizes", async () => {
    const { imageDimensions, imageSizeOk } = await import("./image-size");
    const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0, 0, 0x27, 0x10], 16); png.set([0, 0, 0x27, 0x10], 20); // 10000 x 10000 = 100 MP
    expect(imageDimensions(png)).toEqual({ width: 10000, height: 10000 });
    expect(imageSizeOk(imageDimensions(png))).toBe(false);
    png.set([0, 0, 1, 0], 16); png.set([0, 0, 1, 0], 20); // 256 x 256
    expect(imageSizeOk(imageDimensions(png))).toBe(true);
    expect(imageDimensions(new Uint8Array(30))).toBeNull();
  });
});

import { validPicture } from "./data/validate-state";
describe("profile picture URLs", () => {
  it("accepts data images and Google avatar hosts only", () => {
    expect(validPicture("data:image/png;base64,AAAA")).toBe(true);
    expect(validPicture("https://lh3.googleusercontent.com/a/abc=s96")).toBe(true);
    expect(validPicture("https://tracker.example.com/pixel.gif")).toBe(false);
    expect(validPicture("https://evil.com/.googleusercontent.com/x")).toBe(false);
  });
});
