/** Shared domain models. Money is always a decimal *string* — never a JS number. */

export type Currency = "EUR" | "USD" | "GBP";
export type ISODate = string; // YYYY-MM-DD

export interface User {
  id: string;
  name: string;
  email: string;
  company: string;
}

export type LineKind = "item" | "fee";

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  kind: LineKind;
  /** Tax rate in percent, e.g. "21". Undefined = not stated. */
  taxRate?: string;
}

export type PaymentStatus = "unpaid" | "paid" | "overdue";

export interface Invoice {
  id: string;
  vendorId: string;
  vendorName: string;
  number: string;
  date: ISODate;
  dueDate: ISODate;
  currency: Currency;
  lineItems: InvoiceLineItem[];
  /** As stated on the invoice. Sum of `item` lines. */
  subtotal: string;
  discounts: string;
  /** Sum of `fee` lines, as stated. */
  fees: string;
  taxAmount: string;
  /** Invoice-level stated tax rate in percent, if any. */
  taxRate?: string;
  total: string;
  paymentStatus: PaymentStatus;
  source: "demo" | "upload";
  /** Monotonic ordering used to break date ties (original before re-send). */
  createdAt: number;
}

export type VendorCategory =
  | "Infrastructure"
  | "Cloud usage"
  | "Telecom"
  | "Workspace"
  | "Software"
  | "Professional services"
  | "Other";

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  /** Variable-cost vendors (usage based) get wider tolerances. */
  billing: "fixed" | "variable";
  /** User-defined expected invoice total (decimal string). */
  expectedAmount?: string;
  monitoring: { enabled: boolean; notify: boolean };
}

export interface VendorBaseline {
  vendorId: string;
  sampleSize: number;
  previous: string | null;
  average: string | null;
  avg3m: string | null;
  avg6m: string | null;
  typicalTermsDays: number | null;
  knownDescriptions: string[];
}

export interface ContractRate {
  id: string;
  vendorId: string;
  /** Case-insensitive keyword matched against line descriptions. */
  match: string;
  unitPrice: string;
  unit: string;
  currency: Currency;
  note?: string;
}

export type Classification = "CLEAR" | "REVIEW_NEEDED" | "LIKELY_ERROR";
export type Severity = "low" | "medium" | "high";
export type Confidence = "high" | "medium" | "low";

export type RuleId =
  | "arithmetic"
  | "tax"
  | "duplicate_invoice"
  | "duplicate_line"
  | "dates"
  | "price_history"
  | "contract_rate"
  | "unexpected_fee";

export interface AuditRule {
  id: RuleId;
  name: string;
  description: string;
}

export interface AuditFinding {
  id: string;
  invoiceId: string;
  ruleId: RuleId;
  classification: Exclude<Classification, "CLEAR">;
  severity: Severity;
  title: string;
  explanation: string;
  expected: string;
  actual: string;
  difference: string;
  evidence: string[];
  confidence: Confidence;
  confidenceReason: string;
  uncertainty: string;
  recommendedAction: string;
  /** Decimal string, same currency as the invoice. "0.00" when no money is implicated. */
  amountAtRisk: string;
}

/** User decision on a finding. Engine output is always an *anomaly*; only the user can confirm. */
export type FindingDecision = "open" | "confirmed" | "dismissed";

export type RecoveryStatus =
  | "flagged"
  | "disputed"
  | "vendor_responded"
  | "credit_issued"
  | "recovered"
  | "dismissed";

export interface RecoveryRecord {
  id: string;
  vendorId: string;
  vendorName: string;
  invoiceId?: string;
  findingId?: string;
  title: string;
  amount: string;
  currency: Currency;
  status: RecoveryStatus;
  notes: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type Sensitivity = "relaxed" | "balanced" | "strict";

export interface UserSettings {
  currency: Currency;
  sensitivity: Sensitivity;
  notifications: { weeklyDigest: boolean; highSeverityAlerts: boolean; priceChangeAlerts: boolean };
  privacy: { keepUploadedFiles: false; analytics: boolean };
  disabledRules: RuleId[];
}

export interface AppState {
  version: 1;
  user: User;
  vendors: Vendor[];
  invoices: Invoice[];
  contractRates: ContractRate[];
  recovery: RecoveryRecord[];
  decisions: Record<string, FindingDecision>;
  settings: UserSettings;
}
