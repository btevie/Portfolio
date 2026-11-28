import { paymentArbitrageFindings } from "./payment-arbitrage";
import { roundingBiasFindings } from "./rounding-bias";
import { wkiStaircaseFindings } from "./wki-staircase";
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

/** Whether a finding id names this line. The line id must end the token: line "l1" is not line "l10". */
export function findingNamesLine(findingId: string, lineId: string): boolean {
  return findingId.endsWith(`-${lineId}`) || findingId.split(`line-${lineId}`).slice(1).some((rest) => !/^[\w-]/.test(rest));
}

export function classify(findings: AuditFinding[]): Classification {
  if (findings.some((f) => f.classification === "LIKELY_ERROR")) return "LIKELY_ERROR";
  return findings.length ? "REVIEW_NEEDED" : "CLEAR";
}

/** Pure, deterministic audit. No I/O, no LLM, no floating point money. */
export function auditInvoice(invoice: Invoice, ctx: AuditContext): AuditResult {
  const active = RULES.filter((r) => !ctx.config.disabledRules.includes(r.id as RuleId));
  const forensic = [...forensicAuditFindings(invoice, ctx), ...inflationIndexFindings(invoice, ctx), ...forecastAnomalyFindings(invoice, ctx), ...vendorGraphFindings(invoice, ctx), ...reconcileMathFindings(invoice), ...unitDecompositionFindings(invoice, ctx), ...holtSeasonalFindings(invoice, ctx), ...paymentGuardFindings(invoice, ctx), ...semanticNoveltyFindings(invoice, ctx), ...wkiStaircaseFindings(invoice, ctx), ...roundingBiasFindings(invoice, ctx), ...paymentArbitrageFindings(invoice)].filter((f) => !ctx.config.disabledRules.includes(f.ruleId));
  const core = active.flatMap((r) => r.run(invoice, ctx));
  // The statistical price detectors (CUSUM, forecasting, inflation index, ...) are for increases the core rules miss. When a core
  // price or contract-rate finding already explains this invoice they would report, and add to the amount at stake, the same money again.
  // Only the exposure a core finding really covers is hidden: an invoice-level core finding covers the whole invoice, but a
  // contract-rate finding on one line must not hide an independent price rise on a different line.
  // Line ids in the finding id are exact; the quoted description is only a fallback, because two lines can share a description
  // and one finding must not mark the other as covered.
  const lineIdsIn = (f: AuditFinding) => {
    const byId = invoice.lineItems.filter((l) => findingNamesLine(f.id, l.id)).map((l) => l.id);
    if (byId.length) return byId;
    return invoice.lineItems.filter((l) => l.description.length >= 3 && f.evidence.some((e) => e.includes(`"${l.description}"`))).map((l) => l.id);
  };
  const coveredLines = new Set<string>();
  let wholeInvoiceExplained = false;
  for (const f of core) {
    if (f.ruleId !== "price_history" && f.ruleId !== "contract_rate") continue;
    const lines = f.ruleId === "contract_rate" ? lineIdsIn(f) : [];
    if (lines.length) lines.forEach((id) => coveredLines.add(id)); else wholeInvoiceExplained = true;
  }
  const itemLines = invoice.lineItems.filter((l) => l.kind === "item");
  const alreadyCovered = (f: AuditFinding) => {
    if (f.ruleId !== "price_history") return false;
    if (wholeInvoiceExplained) return true;
    if (!coveredLines.size) return false;
    const lines = lineIdsIn(f);
    return lines.length ? lines.every((id) => coveredLines.has(id)) : itemLines.length === 1 && coveredLines.has(itemLines[0].id);
  };
  const drift = cusumChangePointFindings(invoice, ctx).filter((f) => !ctx.config.disabledRules.includes(f.ruleId));
  const extra = [...forensic, ...drift].filter((f) => !alreadyCovered(f));
  const findings = [...core, ...extra]
    .sort((a, b) => (a.classification === b.classification ? 0 : a.classification === "LIKELY_ERROR" ? -1 : 1) || SEV[a.severity] - SEV[b.severity]);
  return {
    invoiceId: invoice.id,
    classification: classify(findings),
    findings,
    comparison: compareToHistory(invoice, ctx),
    rulesRun: active.map((r) => r.id),
  };
}
