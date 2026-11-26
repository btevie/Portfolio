"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, ChevronDown, ClipboardCopy, FileSearch, History, MailPlus, Trash2 } from "lucide-react";
import { D, formatMoney } from "@/lib/audit/money";
import { useAudited } from "@/lib/data/hooks";
import { effectiveClassification, isOpen } from "@/lib/data/selectors";
import { actions } from "@/lib/data/store";
import { draftNote } from "@/lib/dispute";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AuditFinding, Invoice } from "@/lib/types";
import { Button, Card, ClassBadge, ConfidencePill, EmptyState, LinkButton, Modal, PageHeader, Pill, SectionHeader, SeverityPill } from "@/components/ui";

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><dt className="text-xs text-muted">{label}</dt><dd className="num mt-0.5 text-sm font-medium">{children}</dd></div>
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
  const open = audit.findings.filter((f) => isOpen(state, f));
  const cls = effectiveClassification(state, audit);
  const m = (v: string) => formatMoney(v, inv.currency);

  return (
    <>
      <p className="mb-3 text-sm"><Link href="/invoices" className="text-muted hover:text-ink hover:underline">← Invoices</Link></p>
      <PageHeader
        title={`${inv.vendorName} · ${inv.number}`}
        description={cls === "CLEAR" ? (audit.findings.length ? "All findings are resolved or dismissed." : "Everything looks consistent. We'll keep watching for changes.") : "These are anomalies detected by our checks. None is a confirmed error until you confirm it."}
        actions={<>
          <ClassBadge value={cls} />
          {open.length > 0 && <Button variant="primary" onClick={() => setNoteFor(open)}><MailPlus className="size-4" aria-hidden />Generate dispute note</Button>}
          <Button variant="danger" onClick={() => setConfirmDelete(true)} aria-label="Delete invoice"><Trash2 className="size-4" aria-hidden /></Button>
        </>}
      />

      <Card className="mb-6 p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Fact label="Vendor"><Link href={`/vendors/${inv.vendorId}`} className="text-primary hover:underline">{inv.vendorName}</Link></Fact>
          <Fact label="Invoice number">{inv.number}</Fact>
          <Fact label="Invoice date">{fmtDate(inv.date)}</Fact>
          <Fact label="Due date">{fmtDate(inv.dueDate)}</Fact>
          <Fact label="Currency">{inv.currency}</Fact>
          <Fact label="Total amount">{m(inv.total)}</Fact>
          <Fact label="Tax amount">{m(inv.taxAmount)}{inv.taxRate ? ` (${inv.taxRate}%)` : ""}</Fact>
          <Fact label="Payment status"><Pill tone={inv.paymentStatus === "paid" ? "ok" : inv.paymentStatus === "overdue" ? "bad" : "neutral"}>{inv.paymentStatus[0].toUpperCase() + inv.paymentStatus.slice(1)}</Pill></Fact>
        </dl>
        {inv.source === "demo" && <p className="mt-4 border-t border-line pt-3 text-xs text-muted">Demo invoice — fictional vendor and amounts.</p>}
      </Card>

      <section aria-labelledby="findings-h" className="mb-6">
        <h2 id="findings-h" className="mb-3 text-[15px] font-semibold">Audit findings <span className="font-normal text-muted">· {audit.rulesRun.length} checks run</span></h2>
        {audit.findings.length === 0 ? (
          <Card><EmptyState icon={Check} title="No findings">Everything looks consistent. We&apos;ll keep watching for changes.</EmptyState></Card>
        ) : (
          <div className="space-y-3">{audit.findings.map((f) => <FindingCard key={f.id} f={f} inv={inv} onNote={() => setNoteFor([f])} />)}</div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionHeader title="Line items" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted"><tr><th scope="col" className="px-5 py-2.5 font-medium">Description</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Qty</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Unit price</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Total</th></tr></thead>
              <tbody className="divide-y divide-line">
                {inv.lineItems.map((l) => {
                  const flagged = audit.findings.some((f) => f.id.includes(l.id) || (f.ruleId === "unexpected_fee" && f.evidence[0]?.includes(l.description)));
                  return (
                    <tr key={l.id} className={cn(flagged && "bg-warn-bg/50")}>
                      <td className="px-5 py-2.5">{l.description}{l.kind === "fee" && <Pill className="ml-2">Fee</Pill>}{flagged && <span className="sr-only"> (flagged)</span>}</td>
                      <td className="num px-3 py-2.5 text-right">{l.quantity}</td><td className="num px-3 py-2.5 text-right">{m(l.unitPrice)}</td><td className="num px-5 py-2.5 text-right">{m(l.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="num border-t border-line text-sm">
                <tr><th scope="row" colSpan={3} className="px-5 pt-3 pb-1 text-right font-normal text-muted">Subtotal</th><td className="px-5 pt-3 pb-1 text-right">{m(inv.subtotal)}</td></tr>
                {D(inv.discounts).gt(0) && <tr><th scope="row" colSpan={3} className="px-5 py-1 text-right font-normal text-muted">Discounts</th><td className="px-5 py-1 text-right">−{m(inv.discounts)}</td></tr>}
                {D(inv.fees).gt(0) && <tr><th scope="row" colSpan={3} className="px-5 py-1 text-right font-normal text-muted">Fees</th><td className="px-5 py-1 text-right">{m(inv.fees)}</td></tr>}
                <tr><th scope="row" colSpan={3} className="px-5 py-1 text-right font-normal text-muted">Tax</th><td className="px-5 py-1 text-right">{m(inv.taxAmount)}</td></tr>
                <tr><th scope="row" colSpan={3} className="px-5 pt-1 pb-3 text-right font-semibold">Total</th><td className="px-5 pt-1 pb-3 text-right font-semibold">{m(inv.total)}</td></tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card>
          <SectionHeader title="Historical comparison" description={`Net charge before fees and tax`} />
          {audit.comparison.sampleSize === 0 || !audit.comparison.reliable ? (
            <EmptyState icon={History} title="Not enough history yet">We don&apos;t have enough invoice history to establish a reliable baseline yet. Upload more invoices from this vendor to improve monitoring.</EmptyState>
          ) : (
            <dl className="divide-y divide-line text-sm">
              {([
                ["This invoice", audit.comparison.current], ["Previous invoice", audit.comparison.previous],
                ["Historical average", audit.comparison.average], ["Rolling 3-month average", audit.comparison.avg3m], ["Rolling 6-month average", audit.comparison.avg6m],
              ] as const).map(([k, v]) => <div key={k} className="flex justify-between px-5 py-2.5"><dt className="text-muted">{k}</dt><dd className="num font-medium">{v ? m(v) : "—"}</dd></div>)}
              <div className="flex justify-between bg-canvas px-5 py-3"><dt className="text-muted">Change vs {audit.comparison.baselineLabel}</dt><dd className="num font-semibold">{audit.comparison.absDiff ? `${formatMoney(audit.comparison.absDiff, inv.currency, { signed: true })} (${Number(audit.comparison.pctDiff) > 0 ? "+" : ""}${audit.comparison.pctDiff}%)` : "—"}</dd></div>
              <p className="px-5 py-3 text-xs text-muted">Based on {audit.comparison.sampleSize} earlier invoice{audit.comparison.sampleSize === 1 ? "" : "s"}. Under 5% is treated as normal variation; the thresholds can be tuned in Settings.</p>
            </dl>
          )}
        </Card>
      </div>

      <Modal open={noteFor !== null} onClose={() => setNoteFor(null)} title="Dispute or clarification note" wide>
        {noteFor && <NoteEditor key={noteFor.map((f) => f.id).join()} inv={inv} findings={noteFor} onDone={() => setNoteFor(null)} />}
      </Modal>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this invoice?">
        <p className="text-sm text-muted">This removes the invoice and its findings from this browser. Recovery records you created are kept.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={() => { actions.deleteInvoice(inv.id); router.push("/invoices"); }}>Delete invoice</Button></div>
      </Modal>
    </>
  );
}

function FindingCard({ f, inv, onNote }: { f: AuditFinding; inv: Invoice; onNote: () => void }) {
  const { state } = useAudited();
  const sp = useSearchParams();
  const [toggled, setExpanded] = useState<boolean | null>(null);
  const expanded = toggled ?? sp.get("finding") === f.id; // deep links open the finding; the user can still collapse it
  const decision = state.decisions[f.id] ?? "open";
  const record = state.recovery.find((r) => r.findingId === f.id);
  const dismissed = !isOpen(state, f);
  const panel = `finding-${f.id.replace(/[^a-z0-9]/gi, "-")}`;
  const row = (k: string, v: string) => <div><dt className="text-xs text-muted">{k}</dt><dd className="num mt-0.5 text-sm font-medium">{v}</dd></div>;

  return (
    <Card className={cn("overflow-hidden", dismissed && "opacity-70")}>
      <div className="p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ClassBadge value={f.classification} size="sm" /><SeverityPill value={f.severity} /><ConfidencePill value={f.confidence} />
          {decision === "confirmed" ? <Pill tone="bad">Confirmed error</Pill> : decision === "dismissed" ? <Pill>Dismissed</Pill> : <Pill tone="warn">Anomaly detected</Pill>}
        </div>
        <h3 className="text-[15px] font-semibold text-ink">{f.title}</h3>
        <p className="mt-1 text-sm text-muted">{f.explanation}</p>
        <dl className="mt-4 grid grid-cols-3 gap-4">{row("Expected", f.expected)}{row("Actual", f.actual)}{row("Difference", f.difference)}</dl>
        <button type="button" aria-expanded={expanded} aria-controls={panel} onClick={() => setExpanded(!expanded)} className="mt-4 inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-primary hover:underline">
          {expanded ? "Hide details" : "View details"}<ChevronDown className={cn("size-4 transition-transform duration-150", expanded && "rotate-180")} aria-hidden />
        </button>
      </div>
      {expanded && (
        <div id={panel} className="space-y-4 border-t border-line bg-canvas px-5 py-4 text-sm">
          <div><h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Evidence</h4><ul className="mt-1.5 list-disc space-y-1 pl-5">{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
          <div><h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Why {f.confidence} confidence</h4><p className="mt-1.5">{f.confidenceReason}</p></div>
          <div><h4 className="text-xs font-semibold tracking-wide text-muted uppercase">What we can&apos;t know</h4><p className="mt-1.5">{f.uncertainty}</p></div>
          <div><h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Recommended action</h4><p className="mt-1.5">{f.recommendedAction}</p></div>
          {D(f.amountAtRisk).gt(0) && <p className="num text-muted">Amount at stake (incl. tax): <strong className="text-ink">{formatMoney(f.amountAtRisk, inv.currency)}</strong></p>}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {decision !== "confirmed" && <Button size="sm" onClick={() => actions.setDecision(f.id, "confirmed")}>Mark as confirmed error</Button>}
            {decision !== "dismissed" ? <Button size="sm" onClick={() => actions.setDecision(f.id, "dismissed")}>Dismiss — this is expected</Button> : <Button size="sm" onClick={() => actions.setDecision(f.id, "open")}>Reopen</Button>}
            <Button size="sm" onClick={onNote}><MailPlus className="size-3.5" aria-hidden />Draft note</Button>
            {record ? <LinkButton href="/recovery" size="sm">In tracker: {STATUS_LABEL[record.status]}</LinkButton>
              : D(f.amountAtRisk).gt(0) && <Button size="sm" onClick={() => actions.addRecovery({ vendorId: inv.vendorId, vendorName: inv.vendorName, invoiceId: inv.id, findingId: f.id, title: f.title, amount: f.amountAtRisk, currency: inv.currency, notes: "" })}>Track in Recovery</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function NoteEditor({ inv, findings, onDone }: { inv: Invoice; findings: AuditFinding[]; onDone: () => void }) {
  const { state } = useAudited();
  const [text, setText] = useState(() => draftNote(inv, findings, state.decisions, state.user.name));
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const [logged, setLogged] = useState(false);
  const dirty = useMemo(() => text !== draftNote(inv, findings, state.decisions, state.user.name), [text, inv, findings, state.decisions, state.user.name]);

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
      if (existing) actions.updateRecovery(existing.id, { status: "disputed" });
      else actions.addRecovery({ vendorId: inv.vendorId, vendorName: inv.vendorName, invoiceId: inv.id, findingId: f.id, title: f.title, amount: f.amountAtRisk, currency: inv.currency, status: "disputed", notes: "Note drafted in Overbill and sent by me." });
    }
    setLogged(true);
  }

  return (
    <div>
      <p className="mb-3 rounded-md bg-primary-soft px-3 py-2 text-[13px] text-primary">Overbill never sends anything. Edit the draft, copy it, and send it yourself from your own email.</p>
      <label htmlFor="note-text" className="mb-1.5 block text-[13px] font-medium">Draft note {dirty && <span className="font-normal text-muted">· edited</span>}</label>
      <textarea id="note-text" value={text} onChange={(e) => { setText(e.target.value); setCopied("idle"); }} rows={16} className="w-full rounded-md border border-line-strong p-3 font-mono text-[13px] leading-relaxed" />
      <p role="status" className="mt-2 min-h-5 text-[13px]">
        {copied === "ok" && <span className="text-ok">Copied to clipboard.</span>}
        {copied === "fail" && <span className="text-bad">Couldn&apos;t access the clipboard — select the text and copy it manually.</span>}
        {logged && <span className="text-ok"> Logged as disputed in Recovery.</span>}
      </p>
      <div className="mt-3 flex flex-wrap justify-between gap-2">
        <Button onClick={logDisputed} disabled={logged || findings.every((f) => D(f.amountAtRisk).isZero())}>I sent it — log as disputed</Button>
        <div className="flex gap-2"><Button onClick={onDone}>Close</Button><Button variant="primary" onClick={copy}>{copied === "ok" ? <Check className="size-4" aria-hidden /> : <ClipboardCopy className="size-4" aria-hidden />}{copied === "ok" ? "Copied" : "Copy to clipboard"}</Button></div>
      </div>
    </div>
  );
}
