"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardCopy, MailPlus, Printer } from "lucide-react";
import { celebrate } from "@/lib/celebrate";
import { D } from "@/lib/audit/money";
import { useAudited } from "@/lib/data/hooks";
import { actions } from "@/lib/data/store";
import { draftNote } from "@/lib/dispute";
import { availableRequests, buildDisputeKit, defaultRequest, disputePackHtml, kitSummaryText, REQUEST_LABEL, type DisputeRequest } from "@/lib/dispute-kit";
import { cn } from "@/lib/cn";
import type { AuditFinding, Invoice } from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";
import { Button, Disclosure } from "@/components/ui";

const ALL = "all";

/**
 * Dispute kit for an invoice: pick a finding (or all of them), pick what you are asking for, then edit and copy the message.
 * Overbill never sends anything. Every finding is an unconfirmed anomaly until the user confirms it.
 */
export function DisputeKitEditor({ inv, findings, onDone }: { inv: Invoice; findings: AuditFinding[]; onDone: () => void }) {
  const { state } = useAudited();
  const sender = state.user.name;
  const [scope, setScope] = useState<string>(findings.length === 1 ? findings[0].id : ALL);
  const finding = findings.find((f) => f.id === scope);
  const [requests, setRequests] = useState<Record<string, DisputeRequest>>({});
  const request: DisputeRequest = finding ? (requests[finding.id] && availableRequests(finding).includes(requests[finding.id]) ? requests[finding.id] : defaultRequest(finding)) : "explain";
  // Edits are remembered per finding and per ask, so switching around never throws away what you typed.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const key = `${scope}|${finding ? request : ""}`;
  const kit = useMemo(() => (finding ? buildDisputeKit(inv, finding, state.decisions[finding.id], sender, request) : null), [inv, finding, state.decisions, sender, request]);
  const generated = kit ? kit.message : draftNote(inv, findings, state.decisions, sender);
  const text = edits[key] ?? generated;
  const dirty = edits[key] !== undefined && edits[key] !== generated;

  const [copied, setCopied] = useState<"idle" | "ok" | "fail" | "evidence">("idle");
  const [logged, setLogged] = useState(false);
  const inScope = finding ? [finding] : findings;

  // Most mail apps cap the link length, so a long note is trimmed here; "Copy to clipboard" always has the full text.
  const mailto = `mailto:?subject=${encodeURIComponent(kit?.subject ?? `Invoice ${inv.number}: query about charges`)}&body=${encodeURIComponent(text.length > 1800 ? `${text.slice(0, 1800)}\n…` : text)}`;

  async function copyText(value: string, ok: "ok" | "evidence") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(ok);
    } catch {
      const ta = document.getElementById("note-text") as HTMLTextAreaElement | null; // fall back to manual copy
      ta?.select();
      try { setCopied(document.execCommand("copy") ? ok : "fail"); } catch { setCopied("fail"); }
    }
  }

  function printPack() {
    if (!finding || !kit) return;
    const url = URL.createObjectURL(new Blob([disputePackHtml(inv, finding, kit, text)], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function logDisputed() {
    for (const f of inScope) {
      const existing = state.recovery.find((r) => r.findingId === f.id);
      // Never move a case backwards: a recovered, credited or dismissed record must not be reverted by re-logging a dispute.
      if (existing) { if (existing.status === "flagged") actions.updateRecovery(existing.id, { status: "disputed" }); }
      else actions.addRecovery({ vendorId: inv.vendorId, vendorName: inv.vendorName, invoiceId: inv.id, findingId: f.id, title: f.title, amount: f.amountAtRisk, currency: inv.currency, status: "disputed", notes: "Note drafted in Overbill and sent by me." });
    }
    celebrate({ kind: "step", message: "Dispute logged" });
    setLogged(true);
  }

  const chip = (active: boolean) => cn("inline-flex min-h-10 shrink-0 cursor-pointer items-center rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70");

  return (
    <div>
      <p className="mb-3 rounded-md bg-primary-soft px-3 py-2 text-sm text-primary">Overbill never sends anything. These are automated findings, not confirmed errors. Read and edit the message, check it against your contract, then send it yourself. It is a draft, not legal advice.</p>

      {findings.length > 1 && (
        <div role="group" aria-label="Which finding" className="mb-3">
          <p className="mb-1.5 text-sm font-medium">Which finding?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={scope === ALL} onClick={() => { setScope(ALL); setCopied("idle"); setLogged(false); }} className={chip(scope === ALL)}>All in one message ({findings.length})</button>
            {findings.map((f, i) => <button key={f.id} type="button" aria-pressed={scope === f.id} title={f.title} onClick={() => { setScope(f.id); setCopied("idle"); setLogged(false); }} className={cn(chip(scope === f.id), "max-w-full")}><span className="truncate">{i + 1}. {f.title.length > 34 ? `${f.title.slice(0, 33)}…` : f.title}</span></button>)}
          </div>
        </div>
      )}

      {finding && (
        <div role="radiogroup" aria-label="What are you asking for?" className="mb-3">
          <p className="mb-1.5 text-sm font-medium">What are you asking for?</p>
          <div className="flex flex-wrap gap-2">
            {availableRequests(finding).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={request === r} onClick={() => { setRequests((m) => ({ ...m, [finding.id]: r })); setCopied("idle"); }} className={chip(request === r)}>{REQUEST_LABEL[r]}</button>
            ))}
          </div>
        </div>
      )}

      <label htmlFor="note-text" className="mb-1.5 block text-sm font-medium">Draft note {dirty && <span className="font-normal text-muted-foreground">· edited</span>}</label>
      <Textarea id="note-text" value={text} onChange={(e) => { setEdits((m) => ({ ...m, [key]: e.target.value })); setCopied("idle"); }} rows={finding ? 13 : 16} className="font-mono text-sm leading-relaxed" />
      {dirty && <button type="button" onClick={() => setEdits((m) => { const { [key]: _drop, ...rest } = m; void _drop; return rest; })} className="mt-1 min-h-9 cursor-pointer text-xs font-medium text-primary hover:underline">Reset to the suggested wording</button>}
      <p role="status" className="mt-2 min-h-5 text-sm">
        {copied === "ok" && <span className="text-ok">Copied to clipboard.</span>}
        {copied === "evidence" && <span className="text-ok">Evidence copied to clipboard.</span>}
        {copied === "fail" && <span className="text-bad">Couldn&apos;t access the clipboard. Select the text and copy it yourself.</span>}
        {logged && <span className="text-ok"> Logged as disputed in Recovery.</span>}
      </p>

      {finding && kit && (
        <Disclosure className="mt-3" title="Details behind this message" subtitle="Invoice, line, calculation and evidence">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            {kit.invoiceFacts.map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="num font-medium">{v}</dd></div>)}
          </dl>

          <h3 className="mt-5 text-sm font-semibold">{kit.lines.length ? "Line" : "Scope"}</h3>
          {kit.lines.length ? (
            <ul className="mt-1.5 divide-y divide-line rounded-lg border border-line text-sm">
              {kit.lines.map((l) => <li key={l.description} className="flex items-start justify-between gap-3 px-3 py-2"><span className="min-w-0">{l.description}{l.kind === "fee" && <span className="ml-1.5 text-xs text-muted-foreground">(fee)</span>}</span><span className="num shrink-0 text-right">{l.quantity} × {l.unitPrice}<span className="block font-medium">{l.total}</span></span></li>)}
            </ul>
          ) : <p className="mt-1 text-sm text-muted-foreground">This finding is about the whole invoice, not one line.</p>}

          <h3 className="mt-5 text-sm font-semibold">The calculation <span className="font-normal text-muted-foreground">· {kit.rule} check</span></h3>
          <dl className="mt-1.5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-sm sm:grid-cols-4">
            {kit.calculation.map(([k, v]) => <div key={k} className="bg-card px-3 py-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className={cn("num font-semibold", k === "Difference" && "text-primary")}>{v}</dd></div>)}
          </dl>
          <p className="mt-2 text-sm text-muted-foreground">{kit.why}</p>

          <h3 className="mt-5 text-sm font-semibold">Evidence to attach <span className="font-normal text-muted-foreground">· amounts in {inv.currency}</span></h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">{kit.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"><strong className="text-foreground">What we can&apos;t be sure about:</strong> {kit.uncertainty}</p>
          <div className="mt-3"><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => copyText(kitSummaryText(inv, finding, kit), "evidence")}><ClipboardCopy className="size-3.5" aria-hidden />Copy evidence summary</Button><Button size="sm" onClick={printPack}><Printer className="size-3.5" aria-hidden />Print dispute pack</Button></div></div>
        </Disclosure>
      )}

      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <Button onClick={logDisputed} disabled={logged || inScope.every((f) => D(f.amountAtRisk).isZero())}>I sent it, log as disputed</Button>
        <div className="flex flex-wrap gap-2"><Button onClick={onDone}>Close</Button><a href={mailto} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-sm font-medium hover:bg-muted"><MailPlus className="size-4" aria-hidden />Open in email app</a><Button variant="primary" onClick={() => copyText(text, "ok")}>{copied === "ok" ? <Check className="size-4" aria-hidden /> : <ClipboardCopy className="size-4" aria-hidden />}{copied === "ok" ? "Copied" : "Copy to clipboard"}</Button></div>
      </div>
    </div>
  );
}
