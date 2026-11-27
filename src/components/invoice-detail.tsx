"use client";
import { celebrate } from "@/lib/celebrate";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CheckCircle2, ChevronDown, ChevronLeft, ClipboardCopy, FileSearch, History, MailPlus, Trash2, TriangleAlert } from "lucide-react";
import { D, formatMoney } from "@/lib/audit/money";
import { compareLines } from "@/lib/audit/line-compare";
import { configFromSettings } from "@/lib/audit/engine";
import { useAudited } from "@/lib/data/hooks";
import { effectiveClassification, invoiceExposure, isOpen, paymentStatusAt, today } from "@/lib/data/selectors";
import { actions } from "@/lib/data/store";
import { draftNote } from "@/lib/dispute";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AuditFinding, FindingDecision, Invoice } from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";
import { Button, Card, ClassBadge, Disclosure, EmptyState, LinkButton, Modal, MotionBlock, PageHeader, Reveal, Pill, SectionHeader, SeverityPill } from "@/components/ui";

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><dt className="eyebrow">{label}</dt><dd className="num mt-1 text-sm font-semibold">{children}</dd></div>
);

export function InvoiceDetail({ id }: { id: string }) {
  const { state, audits } = useAudited();
  const router = useRouter();
  const inv = state.invoices.find((i) => i.id === id);
  const audit = inv ? audits[inv.id] : undefined;
  const [noteFor, setNoteFor] = useState<AuditFinding[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!inv || !audit) {
    return <Card><EmptyState icon={FileSearch} title="Invoice not found" action={<LinkButton href="/invoices">Back to invoices</LinkButton>}>It may have been deleted, or the demo data was reset.</EmptyState></Card>;
  }
  const lineCmp = compareLines(inv, { today: today(), invoices: state.invoices.filter((i) => !i.isCredit), contractRates: [], config: configFromSettings(state.settings) });
  const open = audit.findings.filter((f) => isOpen(state, f));
  const cls = effectiveClassification(state, audit);
  const paymentStatus = paymentStatusAt(inv);
  const m = (v: string) => formatMoney(v, inv.currency);

  return (
    <>
      <p className="mb-1 text-sm"><Link href="/invoices" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-card px-4 text-foreground ring-1 ring-border transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-ring"><ChevronLeft className="-ml-1 size-4" aria-hidden />Invoices</Link></p>
      <PageHeader
        title={<>{inv.vendorName}<span className="sr-only"> · </span><span className="mt-0.5 block text-base font-normal text-muted-foreground sm:ml-2 sm:inline sm:text-2xl">{inv.number}</span></>}
        description={inv.isCredit ? "Credit note · money owed to you · not a bill to pay" : cls === "CLEAR" ? (audit.findings.length ? "All findings are resolved or dismissed." : "Everything looks consistent with the checks we ran. That is not a guarantee.") : "Start with the box below, then open each finding to see why it was flagged. These are possible problems, not confirmed errors, until you confirm them."}
        actions={<>
          <span className="max-sm:hidden">{inv.isCredit ? <Pill tone="info">Credit note</Pill> : <ClassBadge value={cls} />}</span>
          <Button variant="secondary" className="text-bad" onClick={() => setConfirmDelete(true)} aria-label="Delete invoice"><Trash2 className="size-4" aria-hidden /></Button>
        </>}
      />

      {inv.extraction === "mock" && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-bad-line bg-bad-bg px-5 py-4 text-sm text-bad">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p><strong>Simulated extraction: this is not your document.</strong> The uploaded file was never read; the figures below are a scripted demo example chosen from the file name. Do not rely on this result to pay or dispute a real invoice. Upload a CSV or paste the invoice text for a real check.</p>
        </div>
      )}
      {inv.isCredit && <div role="status" className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary"><strong>Credit note.</strong> This records money owed to you. It is not a bill to pay and is not audited as an invoice.</div>}
      <motion.section aria-label="Verdict" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className={cn("relative mb-4 overflow-hidden rounded-2xl border-l-4 bg-card p-4 ring-1 ring-line sm:mb-6 sm:p-6", open.length === 0 && cls === "CLEAR" ? "border-l-ok" : "border-l-warn")}>
        <p className={cn("relative flex items-center gap-2 text-lg font-semibold", open.length === 0 && cls === "CLEAR" ? "text-ok" : "text-warn")}>
          {open.length === 0 && cls === "CLEAR" ? <><CheckCircle2 className="size-6 shrink-0" aria-hidden />{inv.isCredit ? "Credit note" : "Nothing flagged by our checks"}</> : <><TriangleAlert className="size-6 shrink-0" aria-hidden />{cls === "LIKELY_ERROR" ? "Hold payment until you've reviewed this" : "Check before you pay"}</>}
        </p>
        {open.length > 0 ? (
          <div className="relative mt-4 sm:mt-6">
            <p className="text-sm text-muted-foreground">Possible overcharge on this invoice <span className="text-xs">(&ldquo;at stake&rdquo; = money you might get back if the findings are real)</span></p>
            <p className="num mt-0.5 text-3xl font-semibold tracking-tight sm:text-4xl">{formatMoney(invoiceExposure(open, inv.total), inv.currency)}</p>
            <p className="mt-1 text-sm text-muted-foreground">of {m(inv.total)} total · {open.length} open finding{open.length === 1 ? "" : "s"}, including tax. Not confirmed.</p>
            <Button variant="primary" className="mt-4 w-full sm:w-auto" onClick={() => setNoteFor(open)}><MailPlus className="size-4" aria-hidden />Generate dispute note</Button>
          </div>
        ) : (
          <p className="relative mt-2 text-sm text-muted-foreground">{inv.isCredit ? <>The vendor owes you {m(inv.total)}. Credit notes are tracked, not audited. Check that it is applied to a later invoice or refunded.</> : <>Our checks (totals, tax, duplicates, rates and history) found nothing unusual in {m(inv.total)}. That isn&apos;t a guarantee, so give it a quick look before you pay.</>}</p>
        )}
      </motion.section>
      <section aria-labelledby="findings-h" className="mb-4">
        <h2 id="findings-h" className="mb-3 text-base font-semibold tracking-tight">What we found</h2>
        {audit.findings.length === 0 ? (
          <Card><EmptyState icon={Check} title={inv.isCredit ? "Credit note not audited" : "No findings"}>{inv.isCredit ? "This credit note is recorded separately and is not run through bill checks." : "Everything looks consistent with the checks we ran. That is not proof the invoice is right; compare it with your contract or order if something feels off."}</EmptyState></Card>
        ) : (
          <div className="space-y-3">{audit.findings.map((f, i) => <MotionBlock key={f.id} i={i}><FindingCard f={f} inv={inv} first={f.id === open[0]?.id} onNote={() => setNoteFor([f])} /></MotionBlock>)}</div>
        )}
      </section>
      <Disclosure className="mb-4" title="Invoice details & history" subtitle="Line items, dates and tax" aside={<span className="num text-sm font-semibold">{m(inv.total)}</span>}>
        <div>
      <Card className="mb-6 rounded-[28px] p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Fact label="Vendor"><Link href={`/vendors/${inv.vendorId}`} className="text-primary hover:underline">{inv.vendorName}</Link></Fact>
          <Fact label="Invoice number">{inv.number}</Fact>
          <Fact label="Invoice date">{fmtDate(inv.date)}</Fact>
          <Fact label="Due date">{fmtDate(inv.dueDate)}</Fact>
          <Fact label="Currency">{inv.currency}</Fact>
          <Fact label={inv.isCredit ? "Credit amount" : "Total amount"}>{m(inv.total)}</Fact>
          <Fact label="Tax amount">{m(inv.taxAmount)}{inv.taxRate ? ` (${inv.taxRate}%)` : ""}</Fact>
          <Fact label="Payment status">{inv.isCredit ? <Pill tone="info">Not payable</Pill> : <span className="flex flex-wrap items-center gap-2"><Pill tone={paymentStatus === "paid" ? "ok" : paymentStatus === "overdue" ? "bad" : "neutral"}>{paymentStatus[0].toUpperCase() + paymentStatus.slice(1)}</Pill><Button size="sm" onClick={() => actions.setInvoicePaymentStatus(inv.id, paymentStatus === "paid" ? "unpaid" : "paid")}>{paymentStatus === "paid" ? "Mark unpaid" : "Mark paid"}</Button></span>}</Fact>
        </dl>
        {inv.source === "demo" && <p className="mt-4 border-t border-line pt-3 text-xs text-muted-foreground">Demo invoice with a fictional vendor and amounts.</p>}
      </Card>


      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionHeader title="Line items" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="border-b border-line-strong bg-canvas/60 text-left text-xs tracking-wider text-muted-foreground "><tr><th scope="col" className="px-5 py-2.5 font-medium">Description</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Qty</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Unit price</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Total</th></tr></thead>
              <tbody className="divide-y divide-line">
                {inv.lineItems.map((l) => {
                  const flagged = audit.findings.some((f) => new RegExp(`${l.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`).test(f.id) || (f.ruleId === "unexpected_fee" && f.evidence[0]?.includes(l.description)));
                  return (
                    <tr key={l.id} className={cn(flagged && "bg-warn-bg/60 shadow-[inset_3px_0_0_var(--color-warn)]")}>
                      <td className="px-5 py-2.5">{l.description}{l.kind === "fee" && <Pill className="ml-2">Fee</Pill>}{flagged && <span className="sr-only"> (flagged)</span>}</td>
                      <td className="num px-3 py-2.5 text-right">{l.quantity}</td><td className="num px-3 py-2.5 text-right">{m(l.unitPrice)}</td><td className="num px-5 py-2.5 text-right">{m(l.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="num border-t border-line text-sm">
                <tr><th scope="row" colSpan={3} className="px-5 pt-3 pb-1 text-right font-normal text-muted-foreground">Subtotal</th><td className="px-5 pt-3 pb-1 text-right">{m(inv.subtotal)}</td></tr>
                {D(inv.discounts).gt(0) && <tr><th scope="row" colSpan={3} className="px-5 py-1 text-right font-normal text-muted-foreground">Discounts</th><td className="px-5 py-1 text-right">−{m(inv.discounts)}</td></tr>}
                {D(inv.fees).gt(0) && <tr><th scope="row" colSpan={3} className="px-5 py-1 text-right font-normal text-muted-foreground">Fees</th><td className="px-5 py-1 text-right">{m(inv.fees)}</td></tr>}
                <tr><th scope="row" colSpan={3} className="px-5 py-1 text-right font-normal text-muted-foreground">Tax</th><td className="px-5 py-1 text-right">{m(inv.taxAmount)}</td></tr>
                <tr><th scope="row" colSpan={3} className="px-5 pt-1 pb-3 text-right font-semibold">Total</th><td className="px-5 pt-1 pb-3 text-right font-semibold">{m(inv.total)}</td></tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card>
          <SectionHeader title="Historical comparison" description={`Net charge before fees and tax`} />
          {audit.comparison.sampleSize === 0 || !audit.comparison.reliable ? (
            <EmptyState icon={History} title="Not enough history yet">Not enough history yet. Upload more invoices from this vendor.</EmptyState>
          ) : (
            <dl className="divide-y divide-line text-sm">
              {([
                ["This invoice", audit.comparison.current], ["Previous invoice", audit.comparison.previous],
                ["Historical average", audit.comparison.average], ["Rolling 3-month average", audit.comparison.avg3m], ["Rolling 6-month average", audit.comparison.avg6m],
              ] as const).map(([k, v]) => <div key={k} className="flex justify-between px-5 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="num font-medium">{v ? m(v) : "—"}</dd></div>)}
              <div className="flex justify-between bg-canvas px-5 py-3"><dt className="text-muted-foreground">Change vs {audit.comparison.baselineLabel}</dt><dd className="num font-semibold">{audit.comparison.absDiff ? `${formatMoney(audit.comparison.absDiff, inv.currency, { signed: true })} (${Number(audit.comparison.pctDiff) > 0 ? "+" : ""}${audit.comparison.pctDiff}%)` : "—"}</dd></div>
              <p className="px-5 py-3 text-xs text-muted-foreground">Based on {audit.comparison.sampleSize} earlier invoice{audit.comparison.sampleSize === 1 ? "" : "s"}. Under 5% is treated as normal variation; the thresholds can be tuned in Settings.</p>
            </dl>
          )}
        </Card>
      </div>
      {lineCmp && (
        <Card className="mt-6">
          <SectionHeader title={`Line by line vs ${lineCmp.previous.number}`} description={`Previous invoice from ${lineCmp.previous.vendorName}, ${fmtDate(lineCmp.previous.date)}. Lines are paired only when the descriptions match exactly; a price change is something to ask about, not a confirmed error.`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">Line items compared with the previous invoice</caption>
              <thead className="border-b border-line-strong text-left text-xs text-muted-foreground"><tr><th scope="col" className="px-5 py-2.5 font-medium">Line</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Before</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Now</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Change</th></tr></thead>
              <tbody className="divide-y divide-line">
                {lineCmp.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-5 py-2.5">{r.description}{r.kind === "fee" && <Pill className="ml-2">Fee</Pill>}</td>
                    <td className="num px-3 py-2.5 text-right">{r.prevUnit ? `${r.prevQty} × ${m(r.prevUnit)}` : "—"}</td>
                    <td className="num px-3 py-2.5 text-right">{r.unit ? `${r.qty} × ${m(r.unit)}` : "—"}</td>
                    <td className="num px-5 py-2.5 text-right font-medium">
                      {r.status === "new" ? <Pill tone="warn">Not on previous invoice</Pill> : r.status === "gone" ? <Pill>Not billed this time</Pill> : r.status === "same" ? <span className="text-muted-foreground">No change</span>
                        : r.unitDiff && !D(r.unitDiff).isZero() ? <span className={D(r.unitDiff).gt(0) ? "text-warn" : "text-ok"}>{formatMoney(r.unitDiff, inv.currency, { signed: true })} per unit{r.unitPct ? ` (${Number(r.unitPct) > 0 ? "+" : ""}${r.unitPct}%)` : ""}</span> : <span>Quantity changed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
        </div>
      </Disclosure>

      <Modal open={noteFor !== null} onClose={() => setNoteFor(null)} title="Dispute or clarification note" wide>
        {noteFor && <NoteEditor key={noteFor.map((f) => f.id).join()} inv={inv} findings={noteFor} onDone={() => setNoteFor(null)} />}
      </Modal>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this invoice?">
        <p className="text-sm text-muted-foreground">This removes the invoice and its findings. Recovery cases are kept.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={() => { actions.deleteInvoice(inv.id); router.push("/invoices"); }}>Delete invoice</Button></div>
      </Modal>
    </>
  );
}

function FindingCard({ f, inv, onNote, first }: { f: AuditFinding; inv: Invoice; onNote: () => void; first?: boolean }) {
  const { state } = useAudited();
  const sp = useSearchParams();
  const [toggled, setExpanded] = useState<boolean | null>(null);
  const requested = sp.get("finding");
  const expanded = toggled ?? (requested ? requested === f.id : Boolean(first)); // open the finding you came for, else the first open one; the user can still collapse it
  const decision = state.decisions[f.id] ?? "open";
  const [undo, setUndo] = useState<{ from: FindingDecision; label: string } | null>(null);
  const decide = (to: FindingDecision, label: string) => { setUndo({ from: decision, label }); actions.setDecision(f.id, to); };
  const record = state.recovery.find((r) => r.findingId === f.id);
  const dismissed = !isOpen(state, f);
  const panel = `finding-${f.id.replace(/[^a-z0-9]/gi, "-")}`;
  const row = (k: string, v: string) => <div><dt className="eyebrow">{k}</dt><dd className={cn("num mt-1 text-sm font-semibold", k === "Difference" && "text-warn")}>{v}</dd></div>;

  return (
    <Card className={cn("overflow-hidden rounded-[28px]", dismissed && "opacity-70")}>
      <div className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ClassBadge value={f.classification} size="sm" /><SeverityPill value={f.severity} />
          {decision === "confirmed" ? <Pill tone="bad">Confirmed error</Pill> : decision === "dismissed" ? <Pill>Dismissed</Pill> : null}
        </div>
        <div className="flex items-start justify-between gap-3"><div><h3 className="display text-base font-semibold text-ink">{f.title}</h3><p className="mt-1 text-xs text-muted-foreground">Difference: <span className="font-semibold text-warn">{f.difference}</span></p></div><span className="num shrink-0 text-sm font-semibold text-ink">{D(f.amountAtRisk).gt(0) ? formatMoney(f.amountAtRisk, inv.currency) : ""}</span></div>
        {expanded && <div className="mt-3 space-y-3"><p className="text-sm text-muted-foreground">{f.explanation}</p><dl className="grid grid-cols-3 divide-x divide-line rounded-md border border-line bg-raised [&>div]:px-3 [&>div]:py-2">{row("Should be", f.expected)}{row("Invoice says", f.actual)}{row("Difference", f.difference)}</dl></div>}
        <button type="button" aria-expanded={expanded} aria-controls={panel} onClick={() => setExpanded(!expanded)} className="mt-2 inline-flex min-h-8 cursor-pointer items-center gap-1 text-sm font-semibold text-primary hover:underline">
          {expanded ? "Hide details" : "View details"}<ChevronDown className={cn("size-4 transition-transform duration-150", expanded && "rotate-180")} aria-hidden />
        </button>
      </div>
      <AnimatePresence initial={false}>{expanded && (
        <Reveal><div id={panel} className="space-y-4 border-t border-line bg-canvas/70 px-5 py-4 text-sm">
          <div><h4 className="eyebrow">Why we flagged this</h4><ul className="mt-1.5 list-disc space-y-1 pl-5">{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
          <div><h4 className="eyebrow">How sure are we? (confidence)</h4><p className="mt-1.5">{f.confidenceReason}</p></div>
          <div><h4 className="eyebrow">What we can&apos;t be sure about</h4><p className="mt-1.5">{f.uncertainty}</p></div>
          <div><h4 className="eyebrow">What to do next</h4><p className="mt-1.5">{f.recommendedAction}</p></div>
          {D(f.amountAtRisk).gt(0) && <p className="num text-muted-foreground">Amount at stake (incl. tax): <strong className="text-ink">{formatMoney(f.amountAtRisk, inv.currency)}</strong></p>}
          <p role="status" className="min-h-5 text-sm text-muted-foreground">{undo && <>{undo.label}. <button type="button" className="min-h-11 cursor-pointer font-semibold text-primary hover:underline" onClick={() => { actions.setDecision(f.id, undo.from); setUndo(null); }}>Undo</button></>}</p>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4 [&>*]:max-sm:min-h-11 [&>*]:max-sm:flex-1">
            {decision !== "confirmed" && <Button size="sm" onClick={() => decide("confirmed", "Marked as confirmed")}>I agree: confirm this is an error</Button>}
            {decision !== "dismissed" ? <Button size="sm" onClick={() => decide("dismissed", "Dismissed")}>Dismiss: this is expected</Button> : <Button size="sm" onClick={() => actions.setDecision(f.id, "open")}>Reopen</Button>}
            <Button size="sm" onClick={onNote}><MailPlus className="size-3.5" aria-hidden />Draft note</Button>
            {record ? <LinkButton href="/recovery" size="sm">In tracker: {STATUS_LABEL[record.status]}</LinkButton>
              : D(f.amountAtRisk).gt(0) && <Button size="sm" onClick={() => actions.addRecovery({ vendorId: inv.vendorId, vendorName: inv.vendorName, invoiceId: inv.id, findingId: f.id, title: f.title, amount: f.amountAtRisk, currency: inv.currency, notes: "" })}>Track in Recovery</Button>}
          </div>
        </div></Reveal>
      )}</AnimatePresence>
    </Card>
  );
}

function NoteEditor({ inv, findings, onDone }: { inv: Invoice; findings: AuditFinding[]; onDone: () => void }) {
  const { state } = useAudited();
  const [text, setText] = useState(() => draftNote(inv, findings, state.decisions, state.user.name));
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const [logged, setLogged] = useState(false);
  const dirty = useMemo(() => text !== draftNote(inv, findings, state.decisions, state.user.name), [text, inv, findings, state.decisions, state.user.name]);

  // Most mail apps cap the link length, so a long note is trimmed here; "Copy to clipboard" always has the full text.
  const mailto = `mailto:?subject=${encodeURIComponent(`Invoice ${inv.number}: query about charges`)}&body=${encodeURIComponent(text.length > 1800 ? `${text.slice(0, 1800)}\n…` : text)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      const ta = document.getElementById("note-text") as HTMLTextAreaElement | null; // fall back to manual copy
      ta?.select();
      try { setCopied(document.execCommand("copy") ? "ok" : "fail"); } catch { setCopied("fail"); }
    }
  }

  function logDisputed() {
    for (const f of findings) {
      const existing = state.recovery.find((r) => r.findingId === f.id);
      // Never move a case backwards: a recovered, credited or dismissed record must not be reverted by re-logging a dispute.
      if (existing) { if (existing.status === "flagged") actions.updateRecovery(existing.id, { status: "disputed" }); }
      else actions.addRecovery({ vendorId: inv.vendorId, vendorName: inv.vendorName, invoiceId: inv.id, findingId: f.id, title: f.title, amount: f.amountAtRisk, currency: inv.currency, status: "disputed", notes: "Note drafted in Overbill and sent by me." });
    }
    celebrate({ kind: "step", message: "Dispute logged" });
    setLogged(true);
  }

  return (
    <div>
      <p className="mb-3 rounded-md bg-primary-soft px-3 py-2 text-sm text-primary">Overbill never sends anything. Read and edit it, check it against your contract, then send it yourself. It is a draft, not legal advice.</p>
      <label htmlFor="note-text" className="mb-1.5 block text-sm font-medium">Draft note {dirty && <span className="font-normal text-muted-foreground">· edited</span>}</label>
      <Textarea id="note-text" value={text} onChange={(e) => { setText(e.target.value); setCopied("idle"); }} rows={16} className="font-mono text-sm leading-relaxed" />
      <p role="status" className="mt-2 min-h-5 text-sm">
        {copied === "ok" && <span className="text-ok">Copied to clipboard.</span>}
        {copied === "fail" && <span className="text-bad">Couldn&apos;t access the clipboard. Select the text and copy it yourself.</span>}
        {logged && <span className="text-ok"> Logged as disputed in Recovery.</span>}
      </p>
      <div className="mt-3 flex flex-wrap justify-between gap-2">
        <Button onClick={logDisputed} disabled={logged || findings.every((f) => D(f.amountAtRisk).isZero())}>I sent it, log as disputed</Button>
        <div className="flex flex-wrap gap-2"><Button onClick={onDone}>Close</Button><a href={mailto} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-sm font-medium hover:bg-muted"><MailPlus className="size-4" aria-hidden />Open in email app</a><Button variant="primary" onClick={copy}>{copied === "ok" ? <Check className="size-4" aria-hidden /> : <ClipboardCopy className="size-4" aria-hidden />}{copied === "ok" ? "Copied" : "Copy to clipboard"}</Button></div>
      </div>
    </div>
  );
}
