import type { Currency, InvoiceLineItem } from "../types";

export type FieldKey = "vendorName" | "number" | "date" | "dueDate" | "total";

export interface ExtractedInvoice {
  vendorName: string;
  number: string;
  date: string;
  dueDate: string;
  currency: Currency;
  lines: Omit<InvoiceLineItem, "id">[];
  subtotal: string;
  discounts: string;
  fees: string;
  taxAmount: string;
  taxRate?: string;
  total: string;
  /** Fields that could not be read confidently. The UI asks the user to confirm them before auditing. */
  lowConfidence: FieldKey[];
  /** How this was produced, shown to the user. */
  method: "mock-demo" | "csv" | "text";
}

export type ExtractionInput =
  | { kind: "file"; name: string; type: string; size: number; text?: string }
  | { kind: "text"; text: string };

/**
 * Integration boundary. A real OCR/LLM extractor (e.g. a server route calling a document-AI
 * provider) implements this interface and replaces `extractInvoice` in ./index.ts.
 * Extraction only *reads* a document; every number is validated by the deterministic audit engine.
 */
export interface InvoiceExtractor {
  extract(input: ExtractionInput, ctx: { defaultCurrency: Currency }): Promise<ExtractedInvoice>;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;
export const MAX_TEXT_CHARS = 50_000;
export const ACCEPTED_EXT = ["pdf", "png", "jpg", "jpeg", "webp", "csv"] as const;
