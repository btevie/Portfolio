"use client";
import { AiSecondOpinionCard } from "@/components/ai-second-opinion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CheckCircle2, ChevronDown, HeartPulse, ChevronLeft, FileSearch, History, MailPlus, Trash2, TriangleAlert } from "lucide-react";
import { D, formatMoney } from "@/lib/audit/money";
import { compareLines } from "@/lib/audit/line-compare";
import { configFromSettings } from "@/lib/audit/engine";
import { useAudited } from "@/lib/data/hooks";
import { nextAction } from "@/lib/recovery";
import { effectiveClassification, invoiceExposure, isOpen, paymentStatusAt, today } from "@/lib/data/selectors";
import { actions } from "@/lib/data/store";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/cn";
import { extractionInfo, findingGuide, isSimulated, uncertainFieldLabels } from "@/lib/evidence";
import { MEDICAL_CHECKLIST, MEDICAL_INTRO, MEDICAL_TITLE } from "@/lib/medical";
import { ruleCoverage } from "@/lib/coverage";
import type { AuditFinding, FindingDecision, Invoice } from "@/lib/types";
import { DisputeKitEditor } from "@/components/dispute-kit";
import { MedicalTracker } from "@/components/medical-tracker";
import { buildDisputeKit } from "@/lib/dispute-kit";
import { CreditTracker, LinkedCredits } from "@/components/credit-tracker";
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
  const simulated = isSimulated(inv);
  const lineCmp = simulated ? null : compareLines(inv, { today: today(), invoices: state.invoices.filter((i) => !i.isCredit && !isSimulated(i)), contractRates: [], config: configFromSettings(state.settings) });
  const open = audit.findings.filter((f) => isOpen(state, f));
  const cls = effectiveClassification(state, audit);
  const paymentStatus = paymentStatusAt(inv);
  const m = (v: string) => formatMoney(v, inv.currency);

  return (
    <>
      <p className="-mt-2 mb-4 text-sm"><Link href="/invoices" className="inline-flex min-h-8 items-center gap-0.5 rounded-full bg-card pr-3 pl-2 text-xs text-foreground ring-1 ring-border transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-ring"><ChevronLeft className="size-3.5" aria-hidden />Invoices</Link></p>
      <PageHeader
        title={<>{inv.vendorName}<span className="sr-only"> · </span><span className="mt-0.5 block text-base font-normal text-muted-foreground sm:ml-2 sm:inline sm:text-2xl">{inv.number}</span></>}
        description={inv.isCredit ? "Credit note · money owed to you · not a bill to pay" : cls === "CLEAR" ? (audit.findings.length ? "All findings are resolved or dismissed." : "Everything looks consistent with the checks we ran. That is not a guarantee.") : undefined}
        actions={<>
          <span className="max-sm:hidden">{inv.isCredit ? <Pill tone="info">Credit note</Pill> : isSimulated(inv) ? <Pill tone="bad">Simulated, not your bill</Pill> : <ClassBadge value={cls} />}</span>
          <Button variant="secondary" className="text-bad" onClick={() => setConfirmDelete(true)} aria-label="Delete invoice"><Trash2 className="size-4" aria-hidden /></Button>
        </>}
      />

      {!inv.isCredit && inv.medical && <MedicalNotice inv={inv} />}
      {!inv.isCredit && inv.medical && !isSimulated(inv) && <MedicalTracker inv={inv} />}
      {!inv.isCredit && <SourceNotice inv={inv} />}
      {!inv.isCredit && !inv.medical && !isSimulated(inv) && <p className="-mt-2 mb-4 text-xs text-muted-foreground">Is this a medical bill? <button type="button" onClick={() => actions.setMedical(inv.id, true)} className="min-h-9 cursor-pointer font-medium text-foreground underline underline-offset-2">Mark it as medical</button> for extra checks.</p>}
      {inv.isCredit && <div role="status" className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary"><strong>Credit note.</strong> This records money owed to you. It is not a bill to pay and is not audited as an invoice.</div>}
      {inv.isCredit && <CreditTracker credit={inv} />}
      {!inv.isCredit && (<>
      <motion.section aria-label="Verdict" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className={cn("relative mb-4 overflow-hidden rounded-xl bg-card p-3 ring-1 ring-line sm:mb-5 sm:p-4")}>
        <p className={cn("relative flex items-center gap-2 text-sm font-semibold", !simulated && open.length === 0 && cls === "CLEAR" ? "text-ok" : "text-warn")}>
          {simulated ? <><TriangleAlert className="size-4 shrink-0" aria-hidden />Demo example: not an audit of your bill</> : open.length === 0 && cls === "CLEAR" ? <><CheckCircle2 className="size-4 shrink-0" aria-hidden />{inv.isCredit ? "Credit note" : inv.medical ? "Nothing flagged, but check the medical list above" : "Nothing flagged by our checks"}</> : <><TriangleAlert className="size-4 shrink-0" aria-hidden />{cls === "LIKELY_ERROR" ? "Hold payment until you've reviewed this" : "Check before you pay"}</>}
        </p>
        {simulated ? (
          <p className="relative mt-2 text-sm text-muted-foreground">Overbill did not read your file, so there is no real result. The findings below only show what a check looks like on made-up figures. They are not counted in your totals, and you cannot dispute or track them.</p>
        ) : open.length > 0 ? (
          <div className="relative mt-2">
            <p className="text-xs text-muted-foreground">Possible overcharge, if the findings are real</p>
            <p className="num text-xl font-semibold tracking-tight sm:text-2xl">{formatMoney(invoiceExposure(open, inv.total), inv.currency)}</p>
            <p className="text-xs text-muted-foreground">of {m(inv.total)} total · {open.length} open finding{open.length === 1 ? "" : "s"}, incl. tax. Not confirmed.</p>
            <Button variant="primary" className="mt-3 w-full sm:w-auto" onClick={() => setNoteFor(open)}><MailPlus className="size-4" aria-hidden />Generate dispute note</Button>
          </div>
        ) : (
          <p className="relative mt-2 text-sm text-muted-foreground">{inv.isCredit ? <>The vendor owes you {m(inv.total)}. Credit notes are tracked, not audited. Check that it is applied to a later invoice or refunded.</> : <>Our checks (totals, tax, duplicates, rates and history) found nothing unusual in {m(inv.total)}. That isn&apos;t a guarantee, so give it a quick look before you pay.</>}</p>
        )}
      </motion.section>
      <section aria-labelledby="findings-h" className="mb-4">
        <h2 id="findings-h" className="mb-3 text-base font-semibold tracking-tight">What we found</h2>
        {audit.findings.length === 0 ? (
          <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground"><Check className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span><strong className="font-semibold text-foreground">{inv.isCredit ? "Credit note not audited." : "No findings."}</strong> {inv.isCredit ? "It is recorded separately and not run through bill checks." : "That is not proof the invoice is right. Compare it with your contract or order if something feels off."}</span></p>
        ) : (
          <div className="space-y-3">{audit.findings.map((f, i) => <MotionBlock key={f.id} i={i}><FindingCard f={f} inv={inv} simulated={simulated} first={f.id === open[0]?.id} onNote={() => setNoteFor([f])} /></MotionBlock>)}</div>
        )}
      </section>
      {!inv.isCredit && !simulated && <Coverage inv={inv} />}
      <LinkedCredits bill={inv} />
      </>)}
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
          {simulated ? (
            <EmptyState icon={History} title="Not available for demo examples">This example uses made-up figures, so it cannot show a meaningful price comparison.</EmptyState>
          ) : audit.comparison.sampleSize === 0 || !audit.comparison.reliable ? (
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
      {inv.medical ? <p className="mt-6 rounded-2xl border border-line bg-card px-5 py-4 text-sm text-muted-foreground">AI second opinion is switched off for medical bills, so health information never leaves this device.</p> : <AiSecondOpinionCard invoice={inv} />}
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
        {noteFor && <DisputeKitEditor key={noteFor.map((f) => f.id).join()} inv={inv} findings={noteFor} onDone={() => setNoteFor(null)} />}
      </Modal>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this invoice?">
        <p className="text-sm text-muted-foreground">This removes the invoice and its findings. Recovery cases are kept.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={() => { actions.deleteInvoice(inv.id); router.push("/invoices"); }}>Delete invoice</Button></div>
      </Modal>
    </>
  );
}

/** What each check could and could not look at on this bill, so "nothing found" is read for what it is. */
function Coverage({ inv }: { inv: Invoice }) {
  const { state, audits } = useAudited();
  const audit = audits[inv.id];
  if (!audit) return null;
  const rows = ruleCoverage(inv, audit, state);
  const limited = rows.filter((r) => r.status !== "ran");
  return (
    <Disclosure title="What the checks could see" subtitle={limited.length ? `${rows.length - limited.length} of ${rows.length} checks had what they needed` : `All ${rows.length} checks had what they needed`}>
      <ul className="divide-y divide-line px-5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
            <span className="min-w-0"><span className="font-medium">{r.name}</span>{r.why && <span className="mt-0.5 block text-xs text-muted-foreground">{r.why}</span>}</span>
            <Pill tone={r.status === "ran" ? "ok" : "warn"}>{r.status === "ran" ? "Checked" : r.status === "off" ? "Off" : "Limited"}</Pill>
          </li>
        ))}
      </ul>
      <p className="px-5 pb-4 text-xs text-muted-foreground">&ldquo;Nothing flagged&rdquo; means no anomalies were found by the checks that could run. It does not mean the bill is correct.</p>
    </Disclosure>
  );
}

function FindingCard({ f, inv, onNote, first, simulated }: { f: AuditFinding; inv: Invoice; onNote: () => void; first?: boolean; simulated?: boolean }) {
  const guide = findingGuide(f, inv);
  const { state } = useAudited();
  const sp = useSearchParams();
  const [toggled, setExpanded] = useState<boolean | null>(null);
  const requested = sp.get("finding");
  const expanded = toggled ?? (requested ? requested === f.id : Boolean(first)); // open the finding you came for, else the first open one; the user can still collapse it
  const decision = state.decisions[f.id] ?? "open";
  const [undo, setUndo] = useState<{ from: FindingDecision; label: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [reason, setReason] = useState("");
  const decide = (to: FindingDecision, label: string, why?: string) => { setUndo({ from: decision, label }); actions.setDecision(f.id, to, why); setAsking(false); setReason(""); };
  const savedReason = state.decisionReasons?.[f.id];
  const record = state.recovery.find((r) => r.findingId === f.id);
  const dismissed = !isOpen(state, f);
  const panel = `finding-${f.id.replace(/[^a-z0-9]/gi, "-")}`;

  return (
    <Card className={cn("overflow-hidden rounded-[28px]", dismissed && "opacity-70")}>
      <div className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {simulated && <Pill tone="bad">Simulated, not your bill</Pill>}<ClassBadge value={f.classification} size="sm" /><SeverityPill value={f.severity} />
          {decision === "confirmed" ? <Pill tone="bad">Confirmed error</Pill> : decision === "dismissed" ? <Pill>Dismissed</Pill> : null}
        </div>
        <div className="flex items-start justify-between gap-3"><div><h3 className="display text-base font-semibold text-ink">{f.title}</h3><p className="mt-1 text-xs text-muted-foreground">Difference: <span className="font-semibold text-warn">{f.difference}</span></p></div><span className="num shrink-0 text-sm font-semibold text-ink">{D(f.amountAtRisk).gt(0) ? formatMoney(f.amountAtRisk, inv.currency) : ""}</span></div>
        {expanded && <div className="mt-3 space-y-3"><p className="text-sm text-muted-foreground">{f.explanation}</p></div>}
        <button type="button" aria-expanded={expanded} aria-controls={panel} onClick={() => setExpanded(!expanded)} className="mt-2 inline-flex min-h-8 cursor-pointer items-center gap-1 text-sm font-semibold text-primary hover:underline">
          {expanded ? "Hide details" : "View details"}<ChevronDown className={cn("size-4 transition-transform duration-150", expanded && "rotate-180")} aria-hidden />
        </button>
      </div>
      <AnimatePresence initial={false}>{expanded && (
        <Reveal><div id={panel} className="space-y-4 border-t border-line bg-canvas/70 px-5 py-4 text-sm">
          <EvidenceBlock guide={guide} simulated={simulated} />
          <div><h4 className="eyebrow">Why we flagged this</h4><ul className="mt-1.5 list-disc space-y-1 pl-5">{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
          <div><h4 className="eyebrow">How sure are we? (confidence)</h4><p className="mt-1.5">{f.confidenceReason}</p></div>
          <div><h4 className="eyebrow">What we can&apos;t be sure about</h4><p className="mt-1.5">{f.uncertainty}</p></div>
          <div>
            <h4 className="eyebrow">What to do next</h4>
            <p className="mt-1.5">{f.recommendedAction}</p>
            {!simulated && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    const kit = buildDisputeKit(inv, f, decision, "");
                    try { await navigator.clipboard.writeText(`Subject: ${kit.subject}\n\n${kit.message}`); setCopied("ok"); } catch { setCopied("fail"); }
                  }}
                >
                  <MailPlus className="mr-1.5 size-3.5" aria-hidden />
                  Copy dispute email
                </Button>
                <span role="status" className={cn("text-sm", copied === "fail" ? "text-bad" : "text-muted-foreground")}>{copied === "ok" ? "Dispute email copied. Nothing was sent." : copied === "fail" ? "Could not copy. Use Draft note and copy from there." : ""}</span>
              </div>
            )}
          </div>
          {D(f.amountAtRisk).gt(0) && <p className="num text-muted-foreground">Amount at stake (incl. tax): <strong className="text-ink">{formatMoney(f.amountAtRisk, inv.currency)}</strong></p>}
          <p role="status" className="min-h-5 text-sm text-muted-foreground">{undo && <>{undo.label}. <button type="button" className="min-h-11 cursor-pointer font-semibold text-primary hover:underline" onClick={() => { actions.setDecision(f.id, undo.from); setUndo(null); }}>Undo</button></>}</p>
          {simulated ? <p className="border-t border-line pt-4 text-sm text-muted-foreground">Decisions, notes and tracking are switched off for simulated results, because they would describe a bill that does not exist.</p> : (
          <>
          {savedReason && decision !== "open" && <p className="text-sm text-muted-foreground"><span className="font-medium text-ink">Your reason:</span> {savedReason}</p>}
          {asking && (
            <div className="space-y-2 rounded-xl bg-card p-3 ring-1 ring-line">
              <label htmlFor={`why-${panel}`} className="text-sm font-medium">Why is this fine? <span className="font-normal text-muted-foreground">(kept with your decision; optional)</span></label>
              <div className="flex flex-wrap gap-2">{["Agreed with the vendor", "Already sorted out", "I misread the bill", "Normal for this vendor"].map((t) => <button key={t} type="button" onClick={() => setReason(t)} className="min-h-11 cursor-pointer rounded-full bg-muted px-3 text-sm sm:min-h-9">{t}</button>)}</div>
              <input id={`why-${panel}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="h-11 w-full rounded-xl border bg-canvas px-3 text-sm" placeholder="e.g. Price rise is in the renewal notice" />
              <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => decide("dismissed", "Dismissed", reason)}>Dismiss finding</Button><Button size="sm" onClick={() => setAsking(false)}>Cancel</Button></div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4 [&>*]:max-sm:min-h-11 [&>*]:max-sm:flex-1">
            {decision !== "confirmed" && <Button size="sm" onClick={() => decide("confirmed", "Marked as confirmed")}>I agree: confirm this is an error</Button>}
            {(f.ruleId === "price_history" || f.ruleId === "unexpected_fee") && !state.settings.exceptions.some((e) => e.vendorId === inv.vendorId && e.ruleId === f.ruleId) && <Button size="sm" onClick={() => { actions.addVendorException(inv.vendorId, f.ruleId as "price_history" | "unexpected_fee", `Expected from invoice ${inv.number}`); }}>Expected: don&apos;t flag this for {inv.vendorName}</Button>}
            {decision !== "dismissed" ? <Button size="sm" onClick={() => setAsking(true)} aria-expanded={asking}>Dismiss: this is expected</Button> : <Button size="sm" onClick={() => actions.setDecision(f.id, "open")}>Reopen</Button>}
            <Button size="sm" onClick={onNote}><MailPlus className="size-3.5" aria-hidden />Draft note</Button>
            {record ? <LinkButton href={`/recovery?case=${encodeURIComponent(record.id)}`} size="sm">Open case: {STATUS_LABEL[record.status]}{(() => { const a = nextAction(record, today()); return a && a.overdueDays > 0 ? " · follow-up overdue" : ""; })()}</LinkButton>
              : D(f.amountAtRisk).gt(0) && <Button size="sm" onClick={() => actions.addRecovery({ vendorId: inv.vendorId, vendorName: inv.vendorName, invoiceId: inv.id, findingId: f.id, title: f.title, amount: f.amountAtRisk, currency: inv.currency, notes: "" })}>Track in Recovery</Button>}
          </div></>)}
        </div></Reveal>
      )}</AnimatePresence>
    </Card>
  );
}


/** Where the invoice's figures came from, shown above the verdict. Simulated extraction gets an unmissable alert. */
function SourceNotice({ inv }: { inv: Invoice }) {
  const info = extractionInfo(inv);
  const unc = uncertainFieldLabels(inv);
  if (info.kind === "simulated") {
    return (
      <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-bad-line bg-bad-bg px-4 py-4 text-sm text-bad sm:px-5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <p><strong>Simulated extraction: this is not your document.</strong></p>
          <p>{info.detail}</p>
          <p>Do not use this result to pay or dispute a real invoice. For a real check, upload a CSV, paste the invoice text, or use a PDF whose text you can select.</p>
        </div>
      </div>
    );
  }
  if (info.kind === "sample") return <p className="mb-4 text-xs text-muted-foreground">{info.label}. {info.detail}</p>;
  return (
    <div className="mb-4 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-line">
      <p className="font-medium">{info.label}</p>
      <p className="mt-1 text-muted-foreground">{info.detail}</p>
      {unc.length > 0 && <p className="mt-1 text-muted-foreground">You confirmed the {unc.join(", ")} during review because Overbill was unsure.</p>}
    </div>
  );
}

/** What was checked, the exact figures compared with where each came from, and what to verify on the paper bill. */
function EvidenceBlock({ guide, simulated }: { guide: ReturnType<typeof findingGuide>; simulated?: boolean }) {
  return (
    <div className="space-y-4">
      <div><h4 className="eyebrow">What we checked</h4><p className="mt-1.5"><strong className="font-semibold">{guide.ruleName}.</strong> {guide.checked}</p></div>
      <div>
        <h4 className="eyebrow">Figures compared and where they came from</h4>
        <ul className="mt-1.5 divide-y divide-line rounded-md border border-line bg-card">
          {guide.compared.map((row) => (
            <li key={row.label} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[7rem_1fr] sm:gap-3">
              <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
              <span className="min-w-0"><span className="num block break-words font-semibold">{row.value}</span><span className="block text-xs text-muted-foreground">{row.from}</span></span>
            </li>
          ))}
        </ul>
      </div>
      {guide.readingNotes.length > 0 && <div><h4 className="eyebrow">How reliable the reading is</h4><ul className="mt-1.5 list-disc space-y-1 pl-5">{guide.readingNotes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
      <div>
        <h4 className="eyebrow">{simulated ? "What to do" : "Verify on the original bill"}</h4>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5">{guide.verify.map((v, i) => <li key={i}>{v}</li>)}</ol>
      </div>
    </div>
  );
}


/** Medical bills are shown first and loudly: the cost of a mistake is highest here. */
function MedicalNotice({ inv }: { inv: Invoice }) {
  return (
    <section aria-label="Medical bill" className="mb-5 rounded-2xl border-l-4 border-l-sky-600 bg-sky-600/10 p-4 ring-1 ring-sky-600/30 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-sky-800 dark:text-sky-200"><HeartPulse className="size-5 shrink-0" aria-hidden />{MEDICAL_TITLE}</h2>
      <p className="mt-1.5 text-sm">{MEDICAL_INTRO}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{MEDICAL_CHECKLIST.map((c, i) => <li key={i}>{c}</li>)}</ol>
      <p className="mt-3 text-xs text-muted-foreground">Overbill compares figures; it can&apos;t tell whether a treatment or code is right. This bill is never counted as clear to pay automatically. <button type="button" onClick={() => actions.setMedical(inv.id, false)} className="min-h-9 cursor-pointer font-medium text-foreground underline underline-offset-2">Not a medical bill</button></p>
    </section>
  );
}
