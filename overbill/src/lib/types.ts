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
  extraction?: "mock" | "csv" | "text" | "pdf" | "ocr";
  /** Fields Overbill could not read confidently and the user confirmed before the audit ran (for example "date"). */
  uncertainFields?: string[];
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
  /** What you agreed with this vendor. All optional: Overbill only uses what you enter. */
  contract?: VendorContract;
}

export interface VendorContract {
  /** When the agreement renews (YYYY-MM-DD). */
  renewalDate?: ISODate;
  /** Days of notice needed to cancel or renegotiate before the renewal date. */
  noticeDays?: number;
  /** The most the price may rise at renewal, in percent. A higher increase is flagged. */
  upliftCapPct?: string;
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
  | "opened" | "note" | "status" | "disputed" | "vendor_response" | "credit_issued" | "applied" | "received"
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
  /** Refund money actually received (self-reported; a reference is optional but encouraged). */
  recoveredAmount?: string;
  /** Credit the user reports was applied to their account (self-reported). Kept apart from cash received. */
  appliedAmount?: string;
  nextStep?: string;
  followUpDate?: ISODate;
  deadline?: RecoveryDeadline;
  events?: RecoveryEvent[];
}

/**
 * Credit-note tracking. A credit note being *issued* says nothing about whether the money came back, so the
 * outcome is only ever what the user confirms. The history is append-only: mistakes are reversed, never edited away.
 */
export type CreditEventKind = "linked" | "unlinked" | "applied" | "refunded" | "reversed" | "note";

export interface CreditEvent {
  id: string;
  /** When the user recorded it (ISO timestamp). */
  at: string;
  kind: CreditEventKind;
  text: string;
  /** Settlement events: how much of the credit this settled (positive decimal, credit's currency). */
  amount?: string;
  /** Settlement events: the real-world date the user reports. */
  date?: ISODate;
  /** Evidence: refund reference, remittance advice, statement line, credit-application number… */
  reference?: string;
  /** The bill this event links to, or that the credit was applied to. */
  invoiceId?: string;
  /** Snapshot of "vendor · number" so the history still reads after that bill is deleted. */
  invoiceLabel?: string;
  /** For `reversed`: the id of the settlement event being undone. */
  reverses?: string;
  /** Settlement events: the user ticked "I checked this against my statement / bank". */
  confirmed?: boolean;
}

export interface CreditRecord {
  id: string;
  /** The credit note (an `Invoice` with `isCredit`) this record tracks. */
  creditId: string;
  /** The invoice or later bill the user says this credit relates to. Unset = unmatched. */
  relatedInvoiceId?: string;
  events: CreditEvent[];
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
  /** Tracking for credit notes. Missing in data saved by older versions (treated as empty). */
  credits: CreditRecord[];
  decisions: Record<string, FindingDecision>;
  /** Why the user dismissed or confirmed a finding, keyed by finding id. Absent in data saved by older versions. */
  decisionReasons?: Record<string, string>;
  settings: UserSettings;
}
