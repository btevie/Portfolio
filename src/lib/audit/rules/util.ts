import type { AuditFinding, Invoice, InvoiceLineItem } from "../../types";
import { D, str2, sum } from "../money";

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

/** Weighted tax estimate for an amount spread across lines with different rates. */
export function weightedTaxFactor(lines: InvoiceLineItem[], fallbackRate?: string): number {
  const amounts = lines.map((line) => D(line.quantity).times(D(line.unitPrice)));
  const gross = sum(amounts);
  if (gross.isZero()) return 0;
  const tax = sum(lines.map((line, i) => amounts[i].times(D(line.taxRate ?? fallbackRate ?? "0")).div(100)));
  return tax.div(gross).toNumber();
}

export const withTax = (amount: ReturnType<typeof D>, factor: number): string =>
  str2(amount.times(1 + factor));
