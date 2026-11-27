"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, CircleCheck, Landmark } from "lucide-react";
import { formatMoney } from "@/lib/audit/money";
import { useAppState } from "@/lib/data/store";
import { actions } from "@/lib/data/store";
import { findDuplicatePayments, parseStatement, type DuplicatePayment } from "@/lib/payments/match";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui";
import { FileDropzone } from "@/components/ui/file-dropzone";

const MAX_BYTES = 5 * 1024 * 1024;

/** Finds money paid twice by comparing a bank or card statement CSV with the invoices you have checked. Runs on this device. */
export function PaymentsCheck() {
  const state = useAppState();
  const [result, setResult] = useState<{ dups: DuplicatePayment[]; count: number; skipped: number; name: string } | null>(null);
  const [error, setError] = useState("");
  const [tracked, setTracked] = useState<Set<number>>(new Set());

  async function onFiles(files: File[]) {
    const f = files[0];
    setError(""); setResult(null); setTracked(new Set());
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) return setError("Please choose a .csv file exported from your bank or card provider.");
    if (f.size > MAX_BYTES) return setError("That file is larger than 5 MB. Export a shorter date range.");
    const parsed = parseStatement(await f.text());
    if (parsed.error) return setError(parsed.error);
    setResult({ dups: findDuplicatePayments(parsed.txs, state.invoices), count: parsed.txs.length, skipped: parsed.skipped, name: f.name });
  }

  function track(d: DuplicatePayment, i: number) {
    const inv = d.invoice;
    if (!inv) return;
    actions.addRecovery({
      vendorId: inv.vendorId, vendorName: inv.vendorName, invoiceId: inv.id, currency: inv.currency, amount: d.refundable.toFixed(2),
      title: `Paid more than once: ${inv.number}`, notes: `${d.why} Found by comparing a bank statement in Overbill. Ask the vendor for a refund or credit.`,
    });
    setTracked((t) => new Set(t).add(i));
  }

  return (
    <div className="mx-auto max-w-3xl lg:max-w-none">
      <p className="mb-2 text-sm"><Link href="/pay-run" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-card px-4 ring-1 ring-border"><ChevronLeft className="-ml-1 size-4" aria-hidden />Pay run</Link></p>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Paid twice?</h1>
        <p className="mt-1 text-sm text-muted-foreground">Drop a bank or card statement (CSV). Overbill compares it with your invoices to find payments made more than once. The file is read on this device and never uploaded or saved.</p>
      </header>

      <FileDropzone onFiles={onFiles} accept=".csv,.txt" inputLabel="Choose bank statement" label="Drag your statement here" hint="CSV with Date, Description and Amount columns · up to 5 MB" />
      {error && <p role="alert" className="mt-3 rounded-2xl bg-bad-bg px-4 py-3 text-sm text-bad">{error}</p>}

      {result && (
        <section aria-label="Results" className="mt-5 space-y-3">
          <p className="text-sm text-muted-foreground">Checked {result.count} payment{result.count === 1 ? "" : "s"} from {result.name}{result.skipped ? ` (${result.skipped} row${result.skipped === 1 ? "" : "s"} could not be read)` : ""}.</p>
          {result.dups.length === 0 ? (
            <div className="flex items-center gap-2 rounded-2xl bg-ok-bg px-4 py-3 text-ok ring-1 ring-ok-line"><CircleCheck className="size-5 shrink-0" aria-hidden /><p className="text-sm font-medium">No double payments found. That only covers payments that name a vendor or invoice number we have on file.</p></div>
          ) : result.dups.map((d, i) => (
            <motion.article key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 6) * 0.05 }} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h2 className="truncate text-base font-semibold">{d.vendorName}</h2><p className="mt-0.5 text-sm text-muted-foreground">{d.why}</p></div>
                {d.invoice && <p className="num shrink-0 text-right text-lg font-semibold text-bad">{formatMoney(d.refundable, d.invoice.currency)}<span className="block text-xs font-normal text-muted-foreground">to get back</span></p>}
              </div>
              <ul className="mt-3 divide-y divide-line rounded-xl bg-muted/60 text-sm">
                {d.txs.map((t) => <li key={t.line} className="flex justify-between gap-3 px-3 py-2"><span className="truncate">{fmtDate(t.date)} · {t.description}</span><span className="num shrink-0 font-medium">{t.amount}</span></li>)}
              </ul>
              {d.invoice ? (
                <div className="mt-3 flex justify-end"><Button variant="primary" disabled={tracked.has(i)} onClick={() => track(d, i)}>{tracked.has(i) ? "Added to Recovery" : "Track in Recovery"}</Button></div>
              ) : <p className="mt-3 text-xs text-muted-foreground">No matching invoice, so this can&apos;t be tracked automatically. Check whether it should have been one payment.</p>}
            </motion.article>
          ))}
          <p className="text-xs text-muted-foreground">These are possible double payments, not confirmed ones. Partial payments, deposits and instalments can look alike. Overbill never contacts your bank or vendor.</p>
        </section>
      )}
      {!result && !error && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Landmark className="size-4" aria-hidden />Tip: export the last 3 months from your online banking.</p>}
    </div>
  );
}
