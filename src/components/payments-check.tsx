"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, CircleCheck, Landmark, TriangleAlert } from "lucide-react";
import { formatMoney } from "@/lib/audit/money";
import { actions, useAppState } from "@/lib/data/store";
import {
  applyCorrections, CONVENTION_LABEL, findDuplicatePayments, parseStatement, STRENGTH_LABEL, statementSignature,
  type DuplicatePayment, type ParsedStatement, type SignConvention,
} from "@/lib/payments/match";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button, Pill } from "@/components/ui";
import { Textarea } from "@/components/ui/textarea";
import { FileDropzone } from "@/components/ui/file-dropzone";

const MAX_BYTES = 5 * 1024 * 1024;
const TONE = { strong: "bad", medium: "warn", weak: "neutral" } as const;

/** Finds money possibly paid twice by comparing a bank or card statement CSV with the invoices you have checked. Runs on this device. */
// Which sign convention you chose is remembered per statement format (its column names only), so a bank file asks once.
const CONV_KEY = "overbill:statement-conventions";
function rememberedConvention(text: string): SignConvention | undefined {
  try { const v = (JSON.parse(localStorage.getItem(CONV_KEY) ?? "{}") as Record<string, string>)[statementSignature(text)]; return v === "negative-out" || v === "positive-out" ? v : undefined; } catch { return undefined; }
}
function rememberConvention(text: string, c: SignConvention) {
  try { const all = JSON.parse(localStorage.getItem(CONV_KEY) ?? "{}") as Record<string, string>; all[statementSignature(text)] = c; localStorage.setItem(CONV_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-50)))); } catch { /* storage unavailable: asked again next time */ }
}

// Dismissals are remembered in this browser (only the suggestion ids, which are dates, amounts and line numbers), so the same suggestion does not come back after a reload or a re-upload.
const DISMISS_KEY = "overbill:dismissed-duplicates";
function loadDismissed(): Set<string> { try { const v = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]"); return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-500) : []); } catch { return new Set(); } }
function saveDismissed(s: Set<string>) { try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-500))); } catch { /* storage unavailable: dismissals last for this visit only */ } }

export function PaymentsCheck() {
  const state = useAppState();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [convention, setConvention] = useState<SignConvention | undefined>();
  const [error, setError] = useState("");
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  useEffect(() => saveDismissed(dismissed), [dismissed]);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [relinked, setRelinked] = useState<Map<string, string>>(new Map());

  const [pasteText, setPasteText] = useState("");
  const [fromClipboard, setFromClipboard] = useState(false);
  function loadText(text: string, name = "Pasted rows") {
    setError(""); setConvention(undefined); setTracked(new Set()); setRemoved(new Set()); setRelinked(new Map());
    if (text.length > MAX_BYTES) return setError("That is more than 5 MB of text. Copy a shorter date range.");
    setFile({ name, text });
  }
  // Paste anywhere on the page: copy the rows from your bank's website or a spreadsheet, then press Ctrl/Cmd+V.
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
      const text = ev.clipboardData?.getData("text") ?? "";
      if (text.trim().split(/\r?\n/).length < 1 || !text.trim()) return;
      ev.preventDefault();
      loadText(text, "Pasted from clipboard"); setFromClipboard(true);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const parsed: ParsedStatement | null = useMemo(() => (file ? parseStatement(file.text, { convention }) : null), [file, convention]);
  const dups = useMemo(() => (parsed && !parsed.error && !parsed.ambiguous ? findDuplicatePayments(parsed.txs, state.invoices) : []), [parsed, state.invoices]);
  const { shown, dismissed: hidden } = useMemo(() => applyCorrections(dups, { dismissed, removed, relinked }), [dups, dismissed, removed, relinked]);

  const upload = useRef(0); // the newest selection wins: a slow read of an earlier file must not replace it
  async function onFiles(files: File[]) {
    const f = files[0];
    const mine = ++upload.current;
    setError(""); setFile(null); setConvention(undefined); setTracked(new Set()); setRemoved(new Set()); setRelinked(new Map());
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) return setError("Please choose a .csv file exported from your bank or card provider.");
    if (f.size > MAX_BYTES) return setError("That file is larger than 5 MB. Export a shorter date range.");
    const text = await f.text();
    if (mine === upload.current) { setFile({ name: f.name, text }); setConvention(rememberedConvention(text)); }
  }

  const set = <T,>(setter: (fn: (p: T) => T) => void, fn: (p: T) => T) => setter(fn);
  const addTo = (id: string) => set(setDismissed, (p: Set<string>) => new Set(p).add(id));

  function track(d: DuplicatePayment) {
    const inv = d.invoice;
    if (!inv) return;
    const title = `Possible double payment: ${inv.number}`;
    // Re-uploading the same statement must not open a second case for the same claim.
    // The key is the suggestion's own id (its dates, amounts and statement lines), so two different double payments on one invoice are two cases, and the same one is never two.
    const key = `bank:${d.id}`;
    if (state.recovery.some((r) => r.findingId === key || (r.invoiceId === inv.id && r.title === title && !r.findingId))) { setTracked((t) => new Set(t).add(d.id)); return; }
    actions.addRecovery({
      vendorId: inv.vendorId, vendorName: inv.vendorName, invoiceId: inv.id, findingId: key, currency: inv.currency, amount: d.refundable.toFixed(2),
      title, notes: `${d.reasons.join(" ")} Suggested by comparing a bank statement in Overbill and checked by me. Not yet confirmed with the vendor.`,
    });
    setTracked((t) => new Set(t).add(d.id));
  }

  const resultsReady = parsed && !parsed.error && !parsed.ambiguous;
  return (
    <div className="mx-auto max-w-3xl lg:max-w-none">
      <p className="mb-2 text-sm"><Link href="/pay-run" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-card px-4 ring-1 ring-border"><ChevronLeft className="-ml-1 size-4" aria-hidden />Pay run</Link></p>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Paid twice?</h1>
        <p className="mt-1 text-sm text-muted-foreground">Drop a bank or card statement (CSV). Overbill compares it with your invoices to suggest payments that may have been made more than once. The file is read on this device and never uploaded or saved.</p>
      </header>

      <FileDropzone onFiles={(f) => { setFromClipboard(false); void onFiles(f); }} accept=".csv,.txt,.tsv" inputLabel="Choose bank statement" label="Drop your statement here, or paste it" hint="Any CSV from your bank or card, headers optional · or press Ctrl/Cmd+V to paste rows · up to 5 MB" />
      <details className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">Or paste rows from your bank&apos;s website or a spreadsheet</summary>
        <label htmlFor="stmt-paste" className="sr-only">Statement rows</label>
        <Textarea id="stmt-paste" rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"03/11/2026   NORTHWIND HOSTING NW-47   -166.98\n10/11/2026   NORTHWIND HOSTING NW-47   -166.98"} className="mt-2 font-mono text-sm" />
        <div className="mt-2 flex justify-end"><Button variant="primary" disabled={!pasteText.trim()} onClick={() => { setFromClipboard(false); loadText(pasteText); }}>Check pasted rows</Button></div>
        <p className="mt-2 text-xs text-muted-foreground">Dates, amounts and descriptions are found automatically, with or without a header row. Nothing leaves this device.</p>
      </details>
      {fromClipboard && file && <p role="status" className="mt-2 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs">Pasted from clipboard</p>}
      {error && <p role="alert" className="mt-3 rounded-2xl bg-bad-bg px-4 py-3 text-sm text-bad">{error}</p>}
      {parsed?.error && <p role="alert" className="mt-3 rounded-2xl bg-bad-bg px-4 py-3 text-sm text-bad">{parsed.error}</p>}

      {parsed?.ambiguous && (
        <section aria-label="Choose how amounts are signed" className="mt-4 rounded-2xl bg-warn-bg p-4 text-warn ring-1 ring-warn-line">
          <h2 className="flex items-center gap-2 text-base font-semibold"><TriangleAlert className="size-4 shrink-0" aria-hidden />Which amounts are payments you made?</h2>
          <p className="mt-1 text-sm text-foreground/80">{file?.name} has a single Amount column, so it doesn&apos;t say whether an amount is money out or money in. Banks differ (most bank accounts show payments as negative, most card statements show purchases as positive and refunds as negative), and a wrong guess would show a refund as a payment. Pick one; Overbill remembers it for files with these column names.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {(["negative-out", "positive-out"] as const).map((c) => (
              <Button key={c} variant={parsed.suggested === c ? "primary" : "secondary"} className="h-auto min-h-11 whitespace-normal py-2 text-left" onClick={() => { if (file) rememberConvention(file.text, c); setConvention(c); }}>{c === "positive-out" ? "Positive amounts are payments I made (typical for card statements)" : "Negative amounts are payments I made (typical for bank accounts)"}{parsed.suggested === c ? " · looks like this file" : ""}</Button>
            ))}
          </div>
        </section>
      )}

      {resultsReady && parsed && (
        <section aria-label="Results" className="mt-5 space-y-3">
          <div className="rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
            <p>Checked <strong className="text-foreground">{parsed.txs.length}</strong> payment{parsed.txs.length === 1 ? "" : "s"} from {file?.name}.
              {parsed.incoming.length > 0 && <> <strong className="text-foreground">{parsed.incoming.length}</strong> incoming (money received, ignored).</>}
              {parsed.unreadable.length > 0 && <> <strong className="text-foreground">{parsed.unreadable.length}</strong> row{parsed.unreadable.length === 1 ? "" : "s"} couldn&apos;t be read.</>}</p>
            {parsed.convention && <p className="mt-1 text-xs">Reading amounts as: {CONVENTION_LABEL[parsed.convention]}.{" "}
              {parsed.convention !== "split-columns" && <button type="button" className="min-h-11 cursor-pointer font-semibold text-primary hover:underline" onClick={() => { const next = parsed.convention === "negative-out" ? "positive-out" : "negative-out"; if (file) rememberConvention(file.text, next); setConvention(next); }}>That&apos;s wrong, switch</button>}</p>}
            <p className="mt-1 text-xs">Statement currency isn&apos;t read: amounts are compared with invoice totals as written, so check the currency matches.</p>
          </div>

          {shown.length === 0 ? (
            <div className="flex items-start gap-2 rounded-2xl bg-ok-bg px-4 py-3 text-ok ring-1 ring-ok-line"><CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden /><p className="text-sm font-medium">No possible double payments found. That only covers payments that name a vendor or invoice number we have on file, so it isn&apos;t proof nothing was paid twice.</p></div>
          ) : shown.map((d) => (
            <article key={d.id} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <div className="flex flex-wrap items-center gap-2"><Pill tone={TONE[d.strength]}>{STRENGTH_LABEL[d.strength]}</Pill><span className="text-xs text-muted-foreground">Suggestion, not confirmed</span></div>
              <div className="mt-2 flex items-start justify-between gap-3">
                <h2 className="min-w-0 truncate text-base font-semibold">{d.vendorName}</h2>
                {d.invoice && <p className="num shrink-0 text-right text-lg font-semibold text-warn">{formatMoney(d.refundable, d.invoice.currency)}<span className="block text-xs font-normal text-muted-foreground">possibly paid twice</span></p>}
              </div>
              <h3 className="eyebrow mt-3">Why it was flagged</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>

              <h3 className="eyebrow mt-3">Payments</h3>
              <ul className="mt-1 divide-y divide-line rounded-xl bg-muted/60 text-sm">
                {d.txs.map((t) => (
                  <li key={t.line} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                    <span className="min-w-0 flex-1 basis-48"><span className="block text-xs text-muted-foreground">{fmtDate(t.date)} · row {t.line}</span><span className="block break-words">{t.description}</span></span>
                    <span className="num font-medium">{d.invoice ? formatMoney(t.amount, d.invoice.currency) : t.amount}</span>
                    <button type="button" className="min-h-11 cursor-pointer text-xs font-semibold text-primary hover:underline" aria-label={`Not part of this: ${t.description} on ${fmtDate(t.date)}`} onClick={() => set(setRemoved, (p: Set<number>) => new Set(p).add(t.line))}>Not part of this</button>
                  </li>
                ))}
              </ul>

              {d.invoice ? (
                <>
                  <h3 className="eyebrow mt-3">Related invoice</h3>
                  <div className="mt-1 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                    <Link href={`/invoices/${d.invoice.id}`} className="font-semibold text-primary hover:underline">{d.invoice.vendorName} · {d.invoice.number}</Link>
                    <p className="num text-xs text-muted-foreground">Dated {fmtDate(d.invoice.date)} · total {formatMoney(d.invoice.total, d.invoice.currency)}</p>
                    {(d.alternatives?.length ?? 0) > 1 && (
                      <label className="mt-2 block text-xs text-muted-foreground">Wrong invoice? Link another from this vendor
                        <select className="mt-1 h-11 w-full cursor-pointer rounded-lg bg-card px-2 text-sm text-foreground ring-1 ring-border" value={d.invoice.id} onChange={(e) => set(setRelinked, (p: Map<string, string>) => new Map(p).set(d.id, e.target.value))}>
                          {d.alternatives!.map((i) => <option key={i.id} value={i.id}>{i.number} · {fmtDate(i.date)} · {formatMoney(i.total, i.currency)}</option>)}
                        </select></label>
                    )}
                  </div>
                </>
              ) : <p className="mt-3 text-xs text-muted-foreground">No invoice on file matches, so this can&apos;t be tracked in Recovery. Check whether it should have been one payment.</p>}

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button onClick={() => addTo(d.id)}>Dismiss, this is expected</Button>
                {d.invoice && <Button variant="primary" disabled={tracked.has(d.id)} onClick={() => track(d)}>{tracked.has(d.id) ? "Added to Recovery" : "Track in Recovery"}</Button>}
              </div>
            </article>
          ))}

          {hidden.length > 0 && (
            <p role="status" className="text-sm text-muted-foreground">{hidden.length} dismissed. <button type="button" className="min-h-11 cursor-pointer font-semibold text-primary hover:underline" onClick={() => setDismissed(new Set())}>Undo all</button></p>
          )}

          {parsed.unreadable.length > 0 && (
            <details className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold">{parsed.unreadable.length} row{parsed.unreadable.length === 1 ? "" : "s"} couldn&apos;t be read</summary>
              <p className="mt-1 text-xs text-muted-foreground">These were skipped, so any duplicate among them isn&apos;t shown. Fix them in the file and drop it again.</p>
              <ul className="mt-2 space-y-2 text-sm">{parsed.unreadable.slice(0, 50).map((u) => <li key={u.line} className="rounded-lg bg-muted/60 px-3 py-2"><span className="font-medium">Row {u.line}: </span>{u.reason}<span className="mt-0.5 block break-words text-xs text-muted-foreground">{u.raw}</span></li>)}</ul>
              {parsed.unreadable.length > 50 && <p className="mt-2 text-xs text-muted-foreground">and {parsed.unreadable.length - 50} more.</p>}
            </details>
          )}

          {parsed.incoming.length > 0 && (
            <details className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold">{parsed.incoming.length} incoming row{parsed.incoming.length === 1 ? "" : "s"} ignored</summary>
              <p className="mt-1 text-xs text-muted-foreground">Read as money received under the sign setting above. If these are really your payments, switch the setting.</p>
              <ul className="mt-2 divide-y divide-line text-sm">{parsed.incoming.slice(0, 50).map((t) => <li key={t.line} className={cn("flex justify-between gap-3 py-1.5")}><span className="min-w-0 break-words">{fmtDate(t.date)} · {t.description}</span><span className="num shrink-0">{t.amount}</span></li>)}</ul>
            </details>
          )}
          <p className="text-xs text-muted-foreground">These are possible double payments, not confirmed ones. Partial payments, deposits and instalments can look alike. Overbill never contacts your bank or vendor, Dismissals are remembered in this browser until you choose &quot;Undo all&quot;. Removed payments and changed invoice links last only until you leave this page.</p>
        </section>
      )}
      {!file && !error && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Landmark className="size-4" aria-hidden />Tip: export the last 3 months from your online banking.</p>}
    </div>
  );
}
