import { D, str2 } from "../audit/money";
import type { Currency } from "../types";
import type { ExtractedInvoice } from "./types";

/**
 * MOCK EXTRACTOR — no OCR or AI runs here.
 * PDFs and images are never read; the file name picks one of five scripted demo scenarios so the full
 * audit flow can be demonstrated. The file's bytes are discarded and never stored or sent anywhere.
 * Replace with a real `InvoiceExtractor` (see ./types.ts) when document AI is configured.
 */
export type Scenario = "clear" | "arithmetic" | "price" | "fee" | "duplicate";

export function pickScenario(fileName: string): Scenario {
  const n = fileName.toLowerCase();
  if (/dup|resend|copy/.test(n)) return "duplicate";
  if (/math|arith|error|total/.test(n)) return "arithmetic";
  if (/price|increase|hike/.test(n)) return "price";
  if (/fee|surcharge/.test(n)) return "fee";
  return "clear";
}

const DATE = "2026-11-25";
const DUE = (days: number) => new Date(Date.parse(DATE) + days * 86_400_000).toISOString().slice(0, 10);

function make(o: { vendorName: string; number: string; terms: number; lines: [string, string, string, ("item" | "fee")?][]; totalOverride?: string; currency?: Currency }): ExtractedInvoice {
  const lines = o.lines.map(([description, quantity, unitPrice, kind = "item"]) => ({
    description, quantity, unitPrice, kind, taxRate: "21", total: str2(D(quantity).times(D(unitPrice))),
  }));
  const sub = lines.filter((l) => l.kind === "item").reduce((a, l) => a.plus(D(l.total)), D(0));
  const fees = lines.filter((l) => l.kind === "fee").reduce((a, l) => a.plus(D(l.total)), D(0));
  const tax = sub.plus(fees).times("0.21");
  return {
    vendorName: o.vendorName, number: o.number, date: DATE, dueDate: DUE(o.terms), currency: o.currency ?? "EUR", lines,
    subtotal: str2(sub), discounts: "0.00", fees: str2(fees), taxAmount: str2(tax), taxRate: "21",
    total: o.totalOverride ?? str2(sub.plus(fees).plus(tax)), lowConfidence: [], method: "mock-demo",
  };
}

export function mockExtract(fileName: string, seq: number): ExtractedInvoice {
  const n = 1000 + seq;
  switch (pickScenario(fileName)) {
    case "arithmetic": // line math is right; the printed grand total is not
      return make({ vendorName: "Stackly Software", number: `STK-${n}`, terms: 30, lines: [["Team plan – seats", "12", "9.50"]], totalOverride: "150.04" });
    case "price": // +20% on a fixed €49 plan
      return make({ vendorName: "Brightline Telecom", number: `BT-${n}`, terms: 14, lines: [["Business fibre 500/500", "1", "58.80"], ["Static IP address", "1", "5.00", "fee"], ["Network administration fee", "1", "7.50", "fee"]] });
    case "fee":
      return make({ vendorName: "Orbit Workspace", number: `OW-${n}`, terms: 15, lines: [["Dedicated desk – monthly", "1", "280.00"], ["Cleaning surcharge", "1", "12.00", "fee"]] });
    case "duplicate": // re-send of an existing November invoice
      return make({ vendorName: "Brightline Telecom", number: "BT-88104", terms: 14, lines: [["Business fibre 500/500", "1", "49.00"], ["Static IP address", "1", "5.00", "fee"], ["Network administration fee", "1", "7.50", "fee"]] });
    default:
      return make({ vendorName: "Northwind Hosting", number: `NW-2026-${n}`, terms: 30, lines: [["Managed hosting – Pro plan", "1", "138.00"]] });
  }
}
