import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import Papa from "papaparse";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pdfParse from "pdf-parse";
import type { ExtractedInvoice } from "./lib/extraction/types";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

const ExtractedInvoiceZodSchema = z.object({
  vendorName: z.string().describe("Company, hospital, utility, or vendor name"),
  number: z.string().describe("Invoice or reference number (or 'UNKNOWN' if missing)"),
  date: z.string().describe("YYYY-MM-DD format (use today if missing)"),
  dueDate: z.string().describe("YYYY-MM-DD format (or empty string if missing)"),
  currency: z.enum(["EUR", "USD", "GBP"]).describe("Detect from symbols (€=EUR, $=USD, £=GBP), default EUR"),
  medical: z.boolean().describe("True if this is a healthcare, dental, hospital, or zorgverzekering bill"),
  lines: z.array(
    z.object({
      description: z
        .string()
        .describe("Original item text PLUS plain-language translation of any codes/jargon (e.g. 'REG-REC — Regulatory Cost Recovery Fee (Company Surcharge)')"),
      quantity: z.string().describe("Numeric string e.g. '1'"),
      unitPrice: z.string().describe("Numeric string with 2 decimals e.g. '79.99'"),
      amount: z.string().describe("Numeric string with 2 decimals e.g. '79.99'"),
      category: z.string().describe("e.g. Service, Admin Fee, Equipment Rental, Collection Fee, Tax"),
    })
  ),
  subtotal: z.string(),
  discounts: z.string(),
  fees: z.string(),
  taxAmount: z.string(),
  total: z.string(),
  notes: z
    .array(z.string())
    .describe("Forensic translation notes explaining hidden junk fees, duplicates, or Dutch WIK 14-day rule warnings"),
});

export async function extractBillText(input: string | Buffer, fileType: "text" | "csv" | "pdf"): Promise<string> {
  if (fileType === "csv" && typeof input === "string") {
    const cleanedCsv = input
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
    const parsed = Papa.parse(cleanedCsv, { header: true, skipEmptyLines: true });
    return JSON.stringify(parsed.data, null, 2);
  }

  if (fileType === "pdf" && Buffer.isBuffer(input)) {
    const data = await pdfParse(input);
    return data.text;
  }

  return String(input).trim();
}

export async function aiExtractInvoice(
  input: string | Buffer,
  fileType: "text" | "csv" | "pdf" = "text"
): Promise<ExtractedInvoice | null> {
  const cleanText = await extractBillText(input, fileType);
  const today = new Date().toISOString().slice(0, 10);

  const completion = await openai.chat.completions.parse({
    model: "llama3.2",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: `You are an elite bilingual (English & Dutch) forensic invoice parser with encyclopedic knowledge of medical codes (CPT, DBC/zorgproducten), telecom surcharges, utility tariffs, mechanic labor rates, SaaS billing, and Dutch/EU consumer law (WIK 14-dagenbrief, incassokosten, administratiekosten, BTW).

Your job:
1. Extract the vendor, invoice number, dates (default today: ${today}), currency, and every real line item (ignore blank lines).
2. Expand EVERY obscure code, acronym, or billing abbreviation inside each line's description into plain everyday language (in the same language as the bill) so the audit engine and user immediately see what it actually is.
3. Add concise forensic warnings in 'notes' if you spot duplicate charges, disguised company surcharges, vague admin fees, or premature collection fees.`,
      },
      {
        role: "user",
        content: `Parse and decode this bill:\n\n${cleanText}`,
      },
    ],
    response_format: zodResponseFormat(ExtractedInvoiceZodSchema, "extracted_invoice"),
  });

  const parsed = completion.choices[0].message.parsed;
  if (!parsed) return null;

  // Filter out empty/zero lines and ensure clean numeric formatting for the deterministic engine
  const validLines = parsed.lines
    .filter((l) => parseFloat(l.amount) > 0)
    .map((l) => ({
      description: l.description.slice(0, 200),
      quantity: String(parseFloat(l.quantity) || 1),
      unitPrice: (parseFloat(l.unitPrice) || parseFloat(l.amount) || 0).toFixed(2),
      total: (parseFloat(l.amount) || 0).toFixed(2),
      kind: /fee|surcharge|admin|collection|late/i.test(`${l.category} ${l.description}`) ? ("fee" as const) : ("item" as const),
    }));

  const calculatedTotal = validLines.reduce((sum, l) => sum + parseFloat(l.total), 0).toFixed(2);

  return {
    vendorName: parsed.vendorName || "Unknown Vendor",
    number: parsed.number || "INV-AI",
    date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : today,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate) ? parsed.dueDate : "",
    currency: parsed.currency,
    medical: parsed.medical,
    lines: validLines,
    subtotal: parsed.subtotal || calculatedTotal,
    discounts: parsed.discounts || "0.00",
    fees: parsed.fees || "0.00",
    taxAmount: parsed.taxAmount || "0.00",
    total: parsed.total || calculatedTotal,
    // A language model can invent or misread a figure, so every field is confirmed by the person before the audit runs.
    lowConfidence: ["vendorName", "number", "date", "dueDate", "total"],
    notes: ["Read by the local AI model on this computer (Ollama). It can misread figures, so check every field against the bill.", ...parsed.notes],
    method: fileType === "csv" ? "csv" : fileType === "pdf" ? "pdf" : "text",
  };
}
