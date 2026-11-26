import type { AuditFinding, Invoice } from "../../types";
import { D, str2 } from "../money";

type Base = Omit<AuditFinding, "id" | "invoiceId" | "amountAtRisk"> & { amountAtRisk?: string; key?: string };

export function makeFinding(inv: Invoice, b: Base): AuditFinding {
  const { key, amountAtRisk, ...rest } = b;
  return {
    ...rest,
    id: `${inv.id}:${b.ruleId}${key ? `:${key}` : ""}`,
    invoiceId: inv.id,
    amountAtRisk: amountAtRisk ?? "0.00",
  };
}

/** Effective tax rate (fraction) to apply when estimating the tax-inclusive impact of an over-charge. */
export function taxFactor(inv: Invoice, lineRate?: string): number {
  const r = lineRate ?? inv.taxRate;
  return r ? D(r).div(100).toNumber() : 0;
}

export const withTax = (amount: ReturnType<typeof D>, factor: number): string =>
  str2(amount.times(1 + factor));
