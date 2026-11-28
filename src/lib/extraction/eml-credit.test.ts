import { describe, expect, it } from "vitest";
import { extractInvoice } from ".";

const eml = (body: string) => new TextEncoder().encode(`From: billing@acme.test\r\nSubject: Credit\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`).buffer as ArrayBuffer;

describe("email invoices that need the table reshaped", () => {
  const body = ["Acme BV", "Credit invoice", "Invoice No: CR-1", "Invoice date: 2026-11-01", "Due date: 2026-11-15", "Hosting refund 1 -50.00 -50.00", "Total -50.00"].join("\n");
  it("stays a credit note after the retry, with positive amounts", async () => {
    const r = await extractInvoice({ kind: "file", name: "credit.eml", type: "message/rfc822", size: 200, data: eml(body) }, { defaultCurrency: "EUR" });
    expect(r.isCredit).toBe(true);
    expect(r.lines[0].total).toBe("50.00");
  });
});
