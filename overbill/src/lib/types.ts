/** Shared domain models. Money is always a decimal *string* — never a JS number. */

/** An ISO 4217 code such as "EUR". The full list lives in `lib/currencies.ts`. */
export type Currency = string;
export type ISODate = string; // YYYY-MM-DD

export interface User {
  id: string;
  name: string;
  email: string;
  company: string;
  /** Profile picture: a small image as a data URL, or an https address (for example from Google). */
  picture?: string;
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
  /** How the figures were obtained. "mock" = scripted demo data; the uploaded file was NOT read. */
  extraction?: "mock" | "csv" | "text" | "pdf";
  /** A credit note: the vendor owes you this amount. Amounts are stored positive; it is tracked, not audited, and never counted as spend or money at stake. */
  isCredit?: boolean;
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
  /** Currency of `expectedAmount`; keeps comparisons within the same currency. */
  expectedCurrency?: Currency;
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

export type RecoveryEventKind =
  | "opened" | "note" | "status" | "disputed" | "vendor_response" | "credit_issued" | "received"
  | "correction" | "next_step" | "deadline" | "edit" | "closed" | "reopened";

/** One entry in a case's history. `at` is when the user recorded it; `date` is the real-world date they report. */
export interface RecoveryEvent {
  id: string;
  at: string; // ISO timestamp
  kind: RecoveryEventKind;
  text: string;
  from?: RecoveryStatus;
  to?: RecoveryStatus;
  amount?: string;
  /** Credit note number, refund reference, ticket id… the evidence behind a recorded credit. */
  reference?: string;
  date?: ISODate;
}

/** A claim/dispute deadline the *user* entered, always with the source it came from. Never inferred. */
export interface RecoveryDeadline { date: ISODate; label: string; source: string }

/**
 * `amount` is the amount claimed (at stake). The optional fields below were added later; records stored
 * without them still load and are interpreted by `caseFigures` in lib/recovery.ts.
 */
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
  /** Legacy single free-text note. New notes are history events. */
  notes: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  source?: "demo" | "user";
  /** Total the vendor has agreed to give back (includes anything already received). */
  confirmedAmount?: string;
  /** Money actually received (refund paid or credit applied), backed by a recorded reference. */
  recoveredAmount?: string;
  nextStep?: string;
  followUpDate?: ISODate;
  deadline?: RecoveryDeadline;
  events?: RecoveryEvent[];
}

export type Sensitivity = "relaxed" | "balanced" | "strict";
export type DateFormat = "dmy" | "mdy" | "iso" | "long";

export interface Thresholds { info: number; review: number; high: number }

/** Checks a user may switch off for one vendor (known usage-based billing, expected recurring fees). */
export type ExceptionRuleId = "price_history" | "unexpected_fee";

export interface VendorException {
  id: string;
  vendorId: string;
  ruleId: ExceptionRuleId;
  reason: string;
  /** Last day the exception applies (inclusive). Undefined = until removed. */
  expiresOn?: ISODate;
  createdAt: ISODate;
}

export interface ReminderSettings {
  /** Invoices with open findings that nobody has reviewed for `reviewAfterDays`. */
  overdueReview: boolean;
  /** Unpaid invoices with open findings due within `dueWithinDays`. */
  upcomingDue: boolean;
  /** Disputes with no update for `replyAfterDays`. */
  vendorReply: boolean;
  reviewAfterDays: number;
  dueWithinDays: number;
  replyAfterDays: number;
  /** Also show a browser notification (only while Overbill is open, and only if the browser permits it). */
  browser: boolean;
}

export interface UserSettings {
  currency: Currency;
  /** "custom" when the thresholds were edited by hand. */
  sensitivity: Sensitivity | "custom";
  /** Price-increase thresholds in percent against the vendor baseline. */
  thresholds: Thresholds;
  /** Ignore arithmetic/tax differences up to this amount (decimal string). */
  tolerance: string;
  disabledRules: RuleId[];
  exceptions: VendorException[];
  defaults: { dateFormat: DateFormat; timezone: string; paymentTermsDays: number };
  reminders: ReminderSettings;
  setup: { defaultsConfirmed: boolean; dismissed: boolean };
  privacy: { keepUploadedFiles: false; analytics: boolean };
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
