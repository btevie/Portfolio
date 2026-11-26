import type {
  AuditFinding, Classification, ContractRate, ISODate, Invoice, RuleId, Sensitivity, Vendor,
} from "../types";

export interface AuditConfig {
  /** Percent thresholds for price increases against the baseline. */
  thresholds: { info: number; review: number; high: number };
  /** Multiplier applied to thresholds for usage-based vendors. */
  variableMultiplier: number;
  /** Multiplier from the user's sensitivity preference (strict < 1 < relaxed). */
  sensitivityScale: number;
  /** Absolute rounding tolerance (decimal string, in currency units). */
  roundingTolerance: string;
  /** Minimum prior invoices before a baseline is considered reliable. */
  minHistory: number;
  disabledRules: RuleId[];
}

export interface AuditContext {
  today: ISODate;
  /** Every other invoice the user has (any vendor). The invoice under audit may be included; it is ignored. */
  invoices: Invoice[];
  contractRates: ContractRate[];
  vendor?: Vendor;
  config: AuditConfig;
}

export interface HistoricalComparison {
  sampleSize: number;
  reliable: boolean;
  /** Net (subtotal − discounts) of the invoice under audit. */
  current: string;
  previous: string | null;
  average: string | null;
  avg3m: string | null;
  avg6m: string | null;
  /** The baseline the difference is measured against, and why. */
  baselineLabel: string;
  baseline: string | null;
  absDiff: string | null;
  pctDiff: string | null;
}

export interface AuditResult {
  invoiceId: string;
  classification: Classification;
  findings: AuditFinding[];
  comparison: HistoricalComparison;
  rulesRun: RuleId[];
}

export type Rule = (invoice: Invoice, ctx: AuditContext) => AuditFinding[];

export const SENSITIVITY_SCALE: Record<Sensitivity, number> = { relaxed: 1.5, balanced: 1, strict: 0.6 };

export const DEFAULT_CONFIG: AuditConfig = {
  thresholds: { info: 5, review: 10, high: 20 },
  variableMultiplier: 3,
  sensitivityScale: 1,
  roundingTolerance: "0.01",
  minHistory: 2,
  disabledRules: [],
};
