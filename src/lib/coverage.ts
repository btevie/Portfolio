import { RULES } from "./audit/engine";
import type { AuditResult } from "./audit/types";
import type { AppState, Invoice, RuleId } from "./types";

export interface RuleCoverage {
  id: RuleId;
  name: string;
  /** ran: had what it needs. limited: ran but could not compare much. off: you switched it off. */
  status: "ran" | "limited" | "off";
  /** For limited / off: what is missing, and what would fix it. */
  why?: string;
}

/**
 * Which checks actually had something to compare on this bill. A bill with no findings is only reassuring if the
 * checks could see something, so this says what each one could and could not look at.
 */
export function ruleCoverage(inv: Invoice, audit: AuditResult, state: AppState): RuleCoverage[] {
  const vendor = state.vendors.find((v) => v.id === inv.vendorId);
  const rates = state.contractRates.filter((r) => r.vendorId === inv.vendorId).length;
  const prior = audit.comparison.sampleSize;
  return RULES.map((r): RuleCoverage => {
    const base = { id: r.id, name: r.name };
    if (state.settings.disabledRules.includes(r.id)) return { ...base, status: "off", why: "You switched this check off in Settings." };
    switch (r.id) {
      case "price_history":
        if (!audit.comparison.reliable) return { ...base, status: "limited", why: `Only ${prior} earlier invoice${prior === 1 ? "" : "s"} from this vendor. It needs more history before it compares prices.` };
        break;
      case "unexpected_fee":
        if (prior === 0) return { ...base, status: "limited", why: "No earlier invoices from this vendor to compare fees against." };
        break;
      case "contract_rate":
        if (rates === 0 && !vendor?.expectedAmount && !vendor?.contract?.upliftCapPct) return { ...base, status: "limited", why: "You have not entered an agreed rate, expected amount or price cap for this vendor. Add one on the vendor page." };
        break;
      case "tax":
        if (!inv.taxRate && !inv.lineItems.some((l) => l.taxRate)) return { ...base, status: "limited", why: "No tax rate was stated, so the tax amount could not be recomputed." };
        break;
      case "duplicate_invoice":
        if (state.invoices.filter((i) => i.vendorId === inv.vendorId && i.id !== inv.id && !i.isCredit).length === 0) return { ...base, status: "limited", why: "No other invoices from this vendor to compare against." };
        break;
    }
    return { ...base, status: "ran" };
  });
}
