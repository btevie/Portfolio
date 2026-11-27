"use client";

import Link from "next/link";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Download, PauseCircle, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/audit/money";
import { useAudited } from "@/lib/data/hooks";
import { effectiveClassification, invoiceExposure, isOpen, today } from "@/lib/data/selectors";
import { actions } from "@/lib/data/store";
import { fmtDate } from "@/lib/format";
import { dueDatesCalendar } from "@/lib/calendar";
import { cn } from "@/lib/cn";
import type { Currency, Invoice } from "@/lib/types";
import { Button, EmptyState, LinkButton } from "@/components/ui";

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Per-currency totals as text. Currencies are never added together. */
function totals(list: Invoice[]): string {
  const m = new Map<Currency, number>();
  for (const i of list) m.set(i.currency, (m.get(i.currency) ?? 0) + Number(i.total));
  return [...m.entries()].map(([c, n]) => formatMoney(n.toFixed(2), c)).join(" · ") || "—";
}

function dueText(due: string): { text: string; late: boolean } {
  const days = Math.round((Date.parse(due) - Date.parse(today())) / 86_400_000);
  if (!Number.isFinite(days)) return { text: "No due date", late: false };
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, late: true };
  return { text: days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`, late: false };
}

/** The weekly ritual: before paying a batch, see what is clear to pay and what to hold. */
export function PayRun() {
  const { state, audits } = useAudited();
  const { ready, hold } = useMemo(() => {
    const unpaid = state.invoices.filter((i) => i.paymentStatus !== "paid" && !i.isCredit).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const rows = unpaid.map((invoice) => {
      const a = audits[invoice.id];
      const open = a ? a.findings.filter((f) => isOpen(state, f)) : [];
      return { invoice, open, exposure: invoiceExposure(open, invoice.total), cls: a ? effectiveClassification(state, a) : "CLEAR" as const };
    });
    return { ready: rows.filter((r) => r.cls === "CLEAR"), hold: rows.filter((r) => r.cls !== "CLEAR") };
  }, [state, audits]);

  const credits = state.invoices.filter((i) => i.isCredit);

  function exportCalendar() {
    const flagged = new Set(hold.map((r) => r.invoice.id));
    const blob = new Blob([dueDatesCalendar([...ready, ...hold].map((r) => r.invoice), flagged)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "overbill-due-dates.ics"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportReady() {
    const head = ["vendor", "invoice_number", "due_date", "currency", "amount"];
    const lines = ready.map(({ invoice: i }) => [i.vendorName, i.number, i.dueDate, i.currency, i.total].map(csvCell).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `overbill-pay-run-${today()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (ready.length + hold.length === 0) {
    return (
      <>
        <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pay run</h1></header>
        {credits.length > 0 && <p className="mb-4 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">You have {credits.length} credit note{credits.length === 1 ? "" : "s"} worth {totals(credits)}. Ask the vendor to apply {credits.length === 1 ? "it" : "them"} to your next payment.</p>}
        <EmptyState icon={Wallet} title="Nothing to pay" action={<LinkButton href="/invoices/new" variant="primary">Check an invoice</LinkButton>}>{state.invoices.some((i) => !i.isCredit) ? "Every bill is marked paid. New invoices you check will show up here." : "No bills have been added yet. Credit notes are tracked separately and are not payable."}</EmptyState>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-3xl lg:max-w-none">
      <header className="mb-4 sm:mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pay run</h1>
        <p className="mt-1 text-sm text-muted-foreground">Before you pay this batch: what is clear, and what to hold.</p>
        <p className="mt-2 text-sm"><Link href="/payments" className="font-medium text-primary hover:underline">Check a bank statement for double payments</Link></p>
        <p className="mt-1 text-sm"><button type="button" onClick={exportCalendar} className="cursor-pointer font-medium text-primary hover:underline">Add due dates to your calendar (.ics)</button></p>
      </header>

      <section aria-label="Summary" className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-ok-bg px-3.5 py-3.5 text-ok ring-1 ring-ok-line"><p className="text-xs">No issues detected</p><p className="num mt-1 text-lg font-semibold sm:text-2xl">{totals(ready.map((r) => r.invoice))}</p><p className="text-xs opacity-80">{ready.length} invoice{ready.length === 1 ? "" : "s"}</p></div>
        <div className="rounded-2xl bg-warn-bg px-3.5 py-3.5 text-warn ring-1 ring-warn-line"><p className="text-xs">Hold and review</p><p className="num mt-1 text-lg font-semibold sm:text-2xl">{totals(hold.map((r) => r.invoice))}</p><p className="text-xs opacity-80">{hold.length} invoice{hold.length === 1 ? "" : "s"}</p></div>
      </section>

      {credits.length > 0 && (
        <p className="mb-4 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">You also hold {credits.length} credit note{credits.length === 1 ? "" : "s"} worth {totals(credits)}. Ask the vendor to apply {credits.length === 1 ? "it" : "them"} to your next payment.</p>
      )}

      {hold.length > 0 && (
        <section aria-labelledby="hold-h" className="mb-5">
          <h2 id="hold-h" className="mb-2 flex items-center gap-2 text-sm font-semibold"><PauseCircle className="size-4 text-warn" aria-hidden />Hold: review before paying</h2>
          <ul className="space-y-2">
            {hold.map(({ invoice: i, open, exposure }, k) => {
              const due = dueText(i.dueDate);
              return (
                <motion.li key={i.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(k, 8) * 0.03, duration: 0.25 }}>
                  <Link href={`/invoices/${i.id}`} className="flex min-h-16 items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border transition-transform active:scale-[0.98]">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{i.vendorName}</p><p className="truncate text-xs text-muted-foreground">{open[0]?.title ?? i.number}</p><p className={cn("text-xs font-medium", due.late ? "text-bad" : "text-muted-foreground")}>{due.text}</p></div>
                    <div className="shrink-0 text-right"><p className="num text-sm font-semibold">{formatMoney(i.total, i.currency)}</p><p className="num text-xs font-medium text-warn">{formatMoney(exposure, i.currency)} possible overcharge</p></div>
                  </Link>
                </motion.li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="ready-h">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="ready-h" className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="size-4 text-ok" aria-hidden />No issues detected</h2>
          {ready.length > 0 && (
            <div className="flex gap-2">
              <Button onClick={exportReady}><Download className="size-4" aria-hidden />Payment list (CSV)</Button>
              <Button variant="primary" onClick={() => ready.forEach((r) => actions.setPaymentStatus(r.invoice.id, "paid"))}>Mark all paid</Button>
            </div>
          )}
        </div>
        {ready.length === 0 ? <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">Nothing is clear to pay yet.</p> : (
          <ul className="space-y-2">
            {ready.map(({ invoice: i }, k) => {
              const due = dueText(i.dueDate);
              return (
                <motion.li key={i.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(k, 8) * 0.03, duration: 0.25 }} className="flex min-h-16 items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border">
                  <Link href={`/invoices/${i.id}`} className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{i.vendorName}</p><p className={cn("text-xs", due.late ? "font-medium text-bad" : "text-muted-foreground")}>{i.number} · {due.text} · {fmtDate(i.dueDate)}</p></Link>
                  <p className="num shrink-0 text-sm font-semibold">{formatMoney(i.total, i.currency)}</p>
                  <button type="button" onClick={() => actions.setPaymentStatus(i.id, "paid")} className="inline-flex h-10 shrink-0 cursor-pointer items-center rounded-full bg-muted px-3.5 text-sm font-medium transition-transform active:scale-95">Mark paid</button>
                </motion.li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">&quot;No issues detected&quot; means these checks found nothing unusual. It is not a guarantee. Overbill never makes payments; this list is for you to pay from your own bank.</p>
      </section>
    </div>
  );
}
