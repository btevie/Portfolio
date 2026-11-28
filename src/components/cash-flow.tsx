"use client";
import Link from "next/link";
import { useMemo } from "react";
import { HeartPulse } from "lucide-react";
import { formatMoney } from "@/lib/audit/money";
import { today } from "@/lib/data/selectors";
import { useAppState } from "@/lib/data/store";
import { cashFlow, FLOW_LABEL } from "@/lib/insights";
import { cn } from "@/lib/cn";

/** Unpaid bills by when they fall due. Totals are what the bills say: credits and disputes are not netted off. */
export function CashFlowView() {
  const state = useAppState();
  const flows = useMemo(() => cashFlow(state.invoices, today()), [state.invoices]);
  if (flows.length === 0) return null;
  return (
    <section aria-labelledby="flow-h" className="mt-6" data-testid="cash-flow">
      <h2 id="flow-h" className="mb-1 text-sm font-semibold">What is due, and when</h2>
      <p className="mb-2 text-xs text-muted-foreground">Unpaid bills as written, by due date. Credit notes and disputes are not subtracted, and currencies are never added together.</p>
      {flows.map((f) => {
        const max = Math.max(...f.buckets.map((b) => Number(b.total)), 1);
        return (
          <div key={f.currency} className="mb-3 rounded-2xl bg-card p-4 ring-1 ring-border">
            <p className="mb-2 flex items-baseline justify-between text-sm"><span className="font-medium">{f.currency}</span><span className="num font-semibold">{formatMoney(f.total, f.currency)} unpaid</span></p>
            <ul className="space-y-2">
              {f.buckets.map((b) => (
                <li key={b.bucket}>
                  <Link href={`/invoices?pay=${b.bucket === "overdue" ? "overdue" : "unpaid"}`} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span className={cn("font-medium", b.bucket === "overdue" && "text-bad")}>{FLOW_LABEL[b.bucket]}<span className="ml-2 text-xs font-normal text-muted-foreground">{b.invoices.length} bill{b.invoices.length === 1 ? "" : "s"}</span>{b.medical > 0 && <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-sky-800 dark:text-sky-200"><HeartPulse className="size-3" aria-hidden />{b.medical} medical</span>}</span>
                      <span className="num font-semibold">{formatMoney(b.total, f.currency)}</span>
                    </span>
                    <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", b.bucket === "overdue" ? "bg-bad" : "bg-primary")} style={{ width: `${Math.max(4, (Number(b.total) / max) * 100)}%` }} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
