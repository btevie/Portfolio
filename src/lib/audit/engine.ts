import { semanticNoveltyFindings } from "./semantic-novelty";
import { paymentGuardFindings } from "./payment-guard";
import { cusumChangePointFindings } from "./cusum";
import { holtSeasonalFindings } from "./holt-smoothing";
import { unitDecompositionFindings } from "./unit-decomposition";
import { reconcileMathFindings } from "./reconcile-math";
import { vendorGraphFindings } from "./vendor-graph";
import { forecastAnomalyFindings } from "./forecasting";
import { inflationIndexFindings } from "./inflation-index";
import { forensicAuditFindings } from "./forensics";
import type { AuditFinding, AuditRule, Classification, Invoice, RuleId, UserSettings } from "../types";
import { compareToHistory } from "./history";
import { arithmeticRule } from "./rules/arithmetic";
import { contractRateRule } from "./rules/contract";
import { datesRule } from "./rules/dates";
import { duplicateInvoiceRule, duplicateLineRule } from "./rules/duplicates";
import { unexpectedFeeRule } from "./rules/fees";
import { priceHistoryRule } from "./rules/price";
import { taxRule } from "./rules/tax";
import { DEFAULT_CONFIG, SENSITIVITY_SCALE, type AuditConfig, type AuditContext, type AuditResult, type Rule } from "./types";

export const RULES: (AuditRule & { run: Rule })[] = [
  { id: "arithmetic", name: "Arithmetic", description: "Quantity × price, line sums and subtotal − discounts + tax + fees = total, with rounding tolerance.", run: arithmeticRule },
  { id: "tax", name: "Tax", description: "Tax amount against the stated rate(s); supports several rates on one invoice.", run: taxRule },
  { id: "duplicate_invoice", name: "Duplicate invoices", description: "Exact duplicates and suspicious near-duplicates by vendor, number, total and date.", run: duplicateInvoiceRule },
  { id: "duplicate_line", name: "Duplicate line items", description: "Identical repeated lines (same description, quantity and price).", run: duplicateLineRule },
  { id: "dates", name: "Dates & terms", description: "Invalid ranges, due before invoice date, future dates, changed payment terms.", run: datesRule },
  { id: "price_history", name: "Price history", description: "Compares against previous, average, 3- and 6-month baselines with configurable thresholds.", run: priceHistoryRule },
  { id: "contract_rate", name: "Contract rates", description: "Line prices against rates and expected amounts you entered.", run: contractRateRule },
  { id: "unexpected_fee", name: "Unexpected fees", description: "Fee lines that never appeared on this vendor's earlier invoices.", run: unexpectedFeeRule },
];

export const RULE_META: AuditRule[] = RULES.map(({ id, name, description }) => ({ id, name, description }));

export function configFromSettings(s: Pick<UserSettings, "sensitivity" | "disabledRules"> & Partial<Pick<UserSettings, "thresholds" | "tolerance">>): AuditConfig {
  const scale = s.sensitivity === "custom" ? 1 : SENSITIVITY_SCALE[s.sensitivity];
  return { ...DEFAULT_CONFIG, ...(s.thresholds ? { thresholds: s.thresholds } : {}), ...(s.tolerance ? { roundingTolerance: s.tolerance } : {}), sensitivityScale: scale, disabledRules: s.disabledRules };
}

const SEV = { high: 0, medium: 1, low: 2 } as const;

export function classify(findings: AuditFinding[]): Classification {
  if (findings.some((f) => f.classification === "LIKELY_ERROR")) return "LIKELY_ERROR";
  return findings.length ? "REVIEW_NEEDED" : "CLEAR";
}

/** Pure, deterministic audit. No I/O, no LLM, no floating point money. */
export function auditInvoice(invoice: Invoice, ctx: AuditContext): AuditResult {
  const active = RULES.filter((r) => !ctx.config.disabledRules.includes(r.id as RuleId));
  const forensic = [...forensicAuditFindings(invoice, ctx), ...inflationIndexFindings(invoice, ctx), ...forecastAnomalyFindings(invoice, ctx), ...vendorGraphFindings(invoice, ctx), ...reconcileMathFindings(invoice), ...unitDecompositionFindings(invoice, ctx), ...holtSeasonalFindings(invoice, ctx), ...cusumChangePointFindings(invoice, ctx), ...paymentGuardFindings(invoice, ctx), ...semanticNoveltyFindings(invoice, ctx)].filter((f) => !ctx.config.disabledRules.includes(f.ruleId));
  const findings = [...active.flatMap((r) => r.run(invoice, ctx)), ...forensic]
    .sort((a, b) => (a.classification === b.classification ? 0 : a.classification === "LIKELY_ERROR" ? -1 : 1) || SEV[a.severity] - SEV[b.severity]);
  return {
    invoiceId: invoice.id,
    classification: classify(findings),
    findings,
    comparison: compareToHistory(invoice, ctx),
    rulesRun: active.map((r) => r.id),
  };
}
