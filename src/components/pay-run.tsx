"use client";

import Link from "next/link";
import { CashFlowView } from "@/components/cash-flow";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Download, PauseCircle, Wallet } from "lucide-react";
import { D, formatMoney } from "@/lib/audit/money";
import { useAudited } from "@/lib/data/hooks";
import { effectiveClassification, invoiceExposure, isOpen, today } from "@/lib/data/selectors";
import { actions } from "@/lib/data/store";
import { fmtDate } from "@/lib/format";
import { dueDatesCalendar } from "@/lib/calendar";
import { safeCsvRow } from "@/lib/csv-safe";
import { recurringSignals } from "@/lib/recurring-watch";
import { emptyMedical, missingShort, needsChecks } from "@/lib/medical-tracking";
import { isSimulated } from "@/lib/evidence";
import { cn } from "@/lib/cn";
import type { Currency, Invoice } from "@/lib/types";
import { Button, EmptyState, LinkButton } from "@/components/ui";


/** Per-currency totals as text. Currencies are never added together. */
function totals(list: Invoice[]): string {
  const m = new Map<Currency, ReturnType<typeof D>>();
  for (const i of list) m.set(i.currency, (m.get(i.currency) ?? D(0)).plus(D(i.total))); // exact decimal addition, never floating point
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
    const unpaid = state.invoices.filter((i) => i.paymentStatus !== "paid" && !i.isCredit && !isSimulated(i)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const rows = unpaid.map((invoice) => {
      const a = audits[invoice.id];
      const open = a ? a.findings.filter((f) => isOpen(state, f)) : [];
      return { invoice, open, exposure: invoiceExposure(open, invoice.total), wait: invoice.medical ? (needsChecks(state.medicalBills?.[invoice.id] ?? emptyMedical()) ? missingShort(state.medicalBills?.[invoice.id] ?? emptyMedical()) : []) : [], cls: !a || (invoice.medical && needsChecks(state.medicalBills?.[invoice.id] ?? emptyMedical())) ? "REVIEW_NEEDED" as const : effectiveClassification(state, a) }; // a medical bill stays on hold until the person ticks both checks (or chooses to pay anyway) // no audit yet: hold it, never treat an unchecked invoice as clear
    });
    return { ready: rows.filter((r) => r.cls === "CLEAR"), hold: rows.filter((r) => r.cls !== "CLEAR") };
  }, [state, audits]);

  const credits = state.invoices.filter((i) => i.isCredit);
  const watch = useMemo(() => recurringSignals(state.invoices, today()), [state.invoices]);

  function exportCalendar() {
    const flagged = new Set(hold.map((r) => r.invoice.id));
    const blob = new Blob([dueDatesCalendar([...ready, ...hold].map((r) => r.invoice), flagged)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "overbill-due-dates.ics"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportReady() {
    const head = ["vendor", "invoice_number", "due_date", "currency", "amount"];
    const lines = ready.map(({ invoice: i }) => safeCsvRow([i.vendorName, i.number, i.dueDate, i.currency, i.total]));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `overbill-pay-run-${today()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** What to hold, and why, for whoever pays the bills. Amounts are possible, not confirmed. */
  function exportHold() {
    const head = ["vendor", "invoice_number", "due_date", "currency", "invoice_total", "possible_overcharge_not_confirmed", "why_held"];
    const lines = hold.map(({ invoice: i, open, exposure, wait }) => safeCsvRow([i.vendorName, i.number, i.dueDate, i.currency, i.total, exposure.toFixed(2), [...(wait.length ? [`Medical bill, not ticked yet: ${wait.join("; ")}`] : []), ...open.map((f) => f.title)].join(" | ") || "Audit not available yet"]));
    const blob = new Blob([[safeCsvRow(head), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `overbill-hold-list-${today()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (ready.length + hold.length === 0) {
    return (
      <>
        <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pay run</h1></header>
        {credits.length > 0 && <p className="mb-4 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">You have {credits.length} credit note{credits.length === 1 ? "" : "s"} worth {totals(credits)}. They are not subtracted here. <Link href="/invoices?status=credits" className="font-medium text-primary hover:underline">Check whether each was applied or refunded</Link>.</p>}
        <EmptyState icon={Wallet} title="Nothing to pay" action={<LinkButton href="/invoices/new" variant="primary">Check an invoice</LinkButton>}>{state.invoices.some((i) => !i.isCredit) ? "Every bill is marked paid. New invoices you check will show up here." : "No bills have been added yet. Credit notes are tracked separately and are not payable."}</EmptyState>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-3xl lg:max-w-none">
      <header className="mb-4 sm:mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pay run</h1>
        <p className="mt-1 text-sm text-muted-foreground">Before you pay this batch: what is clear, and what to hold.</p>
        <p className="mt-2 text-sm"><Link href="/payments" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">Check a bank statement for double payments</Link></p>
        <p className="mt-1 text-sm"><button type="button" onClick={exportCalendar} className="cursor-pointer font-medium text-primary hover:underline">Add due dates to your calendar (.ics)</button></p>
      </header>

      <section aria-label="Summary" className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-ok-bg px-3.5 py-3.5 text-ok ring-1 ring-ok-line"><p className="text-xs">No issues detected</p><p className="num mt-1 text-lg font-semibold sm:text-2xl">{totals(ready.map((r) => r.invoice))}</p><p className="text-xs opacity-80">{ready.length} invoice{ready.length === 1 ? "" : "s"}</p></div>
        <div className="rounded-2xl bg-warn-bg px-3.5 py-3.5 text-warn ring-1 ring-warn-line"><p className="text-xs">Hold and review</p><p className="num mt-1 text-lg font-semibold sm:text-2xl">{totals(hold.map((r) => r.invoice))}</p><p className="text-xs opacity-80">{hold.length} invoice{hold.length === 1 ? "" : "s"}</p></div>
      </section>

      {credits.length > 0 && (
        <p className="mb-4 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">You also hold {credits.length} credit note{credits.length === 1 ? "" : "s"} worth {totals(credits)}. Amounts to pay above are the full bills; credits are not subtracted. <Link href="/invoices?status=credits" className="font-medium text-primary hover:underline">Check whether each was applied or refunded</Link>.</p>
      )}

      {hold.length > 0 && (
        <section aria-labelledby="hold-h" className="mb-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="hold-h" className="flex items-center gap-2 text-sm font-semibold"><PauseCircle className="size-4 text-warn" aria-hidden />Hold: review before paying</h2>
            <button type="button" onClick={exportHold} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline sm:min-h-9"><Download className="size-3.5" aria-hidden />Hold list (CSV)</button>
          </div>
          <ul className="space-y-2">
            {hold.map(({ invoice: i, open, exposure, wait }, k) => {
              const due = dueText(i.dueDate);
              return (
                <motion.li key={i.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(k, 8) * 0.03, duration: 0.25 }}>
                  <Link href={`/invoices/${i.id}`} className="flex min-h-16 items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border transition-transform active:scale-[0.98]">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{i.vendorName}</p><p className="truncate text-xs text-muted-foreground">{wait.length ? `Medical bill, waiting on you: ${wait.join(" and ")}` : open[0]?.title ?? (i.medical ? "Medical bill: checked by you, with open findings" : i.number)}</p><p className={cn("text-xs font-medium", due.late ? "text-bad" : "text-muted-foreground")}>{due.text}</p></div>
                    <div className="shrink-0 text-right"><p className="num text-sm font-semibold">{formatMoney(i.total, i.currency)}</p>{exposure.gt(0) && <p className="num text-xs font-medium text-warn">{formatMoney(exposure, i.currency)} possible overcharge</p>}</div>
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

      <CashFlowView />

      {watch.length > 0 && (
        <section aria-labelledby="watch-h" className="mt-6" data-testid="recurring-watch">
          <h2 id="watch-h" className="mb-1 text-sm font-semibold">Recurring bills to double-check</h2>
          <p className="mb-2 text-xs text-muted-foreground">Worked out from each vendor&apos;s own bill dates and totals. These are prompts to look, not proof of a problem.</p>
          <ul className="space-y-2">
            {watch.map((s) => (
              <li key={`${s.vendorId}-${s.currency}-${s.kind}`} className="rounded-2xl bg-card px-4 py-3 ring-1 ring-line">
                <Link href={`/vendors/${s.vendorId}`} className="block">
                  <p className="text-sm font-semibold">{s.vendorName} <span className="font-normal text-muted-foreground">· {s.headline}</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.detail}</p>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">{s.figures.map((f) => <div key={f.label}><dt className="text-muted-foreground">{f.label}</dt><dd className="num font-medium">{f.value}</dd></div>)}</dl>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
