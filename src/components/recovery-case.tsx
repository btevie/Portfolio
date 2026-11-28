"use client";
import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Banknote, CalendarClock, Handshake, MessageSquareReply, Send, StickyNote, Ticket } from "lucide-react";
import { formatMoney } from "@/lib/audit/money";
import { today } from "@/lib/data/selectors";
import { actions, useAppState } from "@/lib/data/store";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import { caseFigures, nextAction, type EventInput } from "@/lib/recovery";
import type { RecoveryEvent, RecoveryRecord } from "@/lib/types";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button, Field, fieldClass, Pill } from "@/components/ui";

type Kind = "contacted" | "reply" | "promise" | "applied" | "received";
const KINDS: { id: Kind; label: string; icon: typeof Send }[] = [
  { id: "contacted", label: "I contacted them", icon: Send },
  { id: "reply", label: "They replied", icon: MessageSquareReply },
  { id: "promise", label: "They promised money", icon: Handshake },
  { id: "applied", label: "Credit applied", icon: Ticket },
  { id: "received", label: "Money received", icon: Banknote },
];
const EVENT_LABEL: Record<RecoveryEvent["kind"], string> = {
  opened: "Opened", note: "Note", status: "Status", disputed: "You contacted the vendor", vendor_response: "Vendor replied", credit_issued: "Vendor promised a refund or credit",
  applied: "Credit applied to your account", received: "Money received", correction: "Correction", next_step: "Next step", deadline: "Deadline", edit: "Edited", closed: "Closed", reopened: "Reopened",
};
const TONE: Record<string, "ok" | "warn" | "info" | "neutral"> = { recovered: "ok", credit_issued: "ok", dismissed: "neutral", flagged: "warn" };

export function CaseDetail({ r }: { r: RecoveryRecord }) {
  const vendorExists = useAppState().vendors.some((v) => v.id === r.vendorId); // removing sample data can leave a case whose vendor page no longer exists
  const f = caseFigures(r);
  const act = nextAction(r, today());
  const fmt = (d: { toFixed(n: number): string }) => formatMoney(d.toFixed(2), r.currency);
  const [kind, setKind] = useState<Kind | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const events = [...(r.events ?? [])].reverse();
  const done = r.status === "recovered" || r.status === "dismissed";
  const availableKinds = r.status === "credit_issued"
    ? KINDS // a late promise still needs "I chased them" and "they replied": those entries keep the promised and received totals as they are
    : r.status === "recovered"
      ? (f.outstanding.gt(0) ? KINDS.filter((k) => k.id === "applied" || k.id === "received") : [])
      : KINDS;

  return (
    <>
      <SheetHeader className="border-b p-5 pr-12">
        <Pill tone={TONE[r.status] ?? "info"} className="w-fit">{STATUS_LABEL[r.status]}</Pill>
        <SheetTitle className="text-base leading-snug">{r.title}</SheetTitle>
        <SheetDescription>
          {r.vendorId && vendorExists ? <Link href={`/vendors/${r.vendorId}`} className="text-primary hover:underline">{r.vendorName}</Link> : r.vendorName}
          {r.invoiceId && <> · <Link href={`/invoices/${r.invoiceId}${r.findingId ? `?finding=${encodeURIComponent(r.findingId)}` : ""}`} className="text-primary hover:underline">View invoice and finding</Link></>}
          {!r.invoiceId && <> · Added by hand, not linked to a finding</>}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-5 p-5">
        <section aria-label="Amounts">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Figure label="Claimed" hint="What you say is owed" value={fmt(f.claimed)} />
            <Figure label="Promised" hint="What the vendor agreed to" value={f.promised ? fmt(f.promised) : "Nothing yet"} />
            <Figure label="Credit applied" hint="On your account, you reported" value={fmt(f.applied)} tone={f.applied.gt(0) ? "ok" : undefined} />
            <Figure label="Refund received" hint={f.legacy ? "Marked recovered before amounts were tracked" : "In your bank, you reported"} value={fmt(f.received)} tone={f.received.gt(0) ? "ok" : undefined} />
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Still to come: <span className="num font-medium text-foreground">{fmt(f.outstanding)}</span>. These are your own records; Overbill cannot see vendor or bank accounts, so nothing here is independently verified.</p>
        </section>

        {r.status !== "dismissed" && (f.applied.gt(0) || f.received.gt(0)) && <CorrectionForm key={`${r.id}-${r.events?.length ?? 0}`} r={r} />}

        {act && (
          <section aria-label="Next action" className={`rounded-xl border p-3.5 ${act.tone === "bad" ? "border-bad/40 bg-bad-bg" : "bg-muted/40"}`}>
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"><CalendarClock className="size-3.5" aria-hidden />Next action{act.overdueDays > 0 && <span className="text-bad normal-case">· {act.overdueDays} day{act.overdueDays === 1 ? "" : "s"} overdue</span>}</p>
            <p className="mt-1 text-sm font-medium">{act.label}</p>
            {!done && (
              <div className="mt-3 flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`fu-${r.id}`} className="mb-1 block text-xs text-muted-foreground">Follow-up date</label>
                  <input id={`fu-${r.id}`} type="date" className={fieldClass} value={r.followUpDate ?? ""} onChange={(e) => actions.setRecoveryFollowUp(r.id, e.target.value || undefined)} />
                </div>
              </div>
            )}
          </section>
        )}

        {r.status !== "dismissed" && availableKinds.length > 0 && (
          <section aria-label="Record an update">
            <h3 className="mb-2 text-sm font-semibold">Record an update</h3>
            <div role="group" aria-label="What happened" className="grid grid-cols-2 gap-2">
              {availableKinds.map((k) => (
                <Button key={k.id} size="sm" variant={kind === k.id ? "primary" : "secondary"} aria-pressed={kind === k.id} className="min-h-11 justify-start" onClick={() => setKind(kind === k.id ? null : k.id)}>
                  <k.icon className="size-4" aria-hidden />{k.label}
                </Button>
              ))}
            </div>
            {kind && availableKinds.some((k) => k.id === kind) && <EventForm key={`${r.id}-${kind}-${r.updatedAt}-${r.events?.length ?? 0}`} r={r} kind={kind} outstanding={f.outstanding.toFixed(2)} onSaved={() => setKind(null)} />}
          </section>
        )}

        <section aria-label="Timeline">
          <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
          {events.length === 0 && !r.notes ? <p className="text-sm text-muted-foreground">Nothing recorded yet. Record when you contact the vendor and what they say.</p> : (
            <ol className="relative space-y-4 border-l border-line pl-4">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" />
                  <p className="text-sm font-medium">{EVENT_LABEL[e.kind]}{e.amount && <span className="num ml-2 font-semibold text-ok">{formatMoney(e.amount, r.currency)}</span>}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(e.date ?? e.at.slice(0, 10))}{e.kind === "credit_issued" && e.date ? " (expected)" : ""}{e.reference ? ` · Ref ${e.reference}` : ""}</p>
                  {e.text && e.kind !== "status" && <p className="mt-1 text-sm break-words whitespace-pre-wrap">{e.text}</p>}
                  {e.kind === "status" && <p className="mt-0.5 text-xs text-muted-foreground">{e.text}</p>}
                </li>
              ))}
              {r.notes && (
                <li className="relative">
                  <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-muted-foreground" />
                  <p className="text-sm font-medium">Earlier note</p>
                  <p className="text-xs text-muted-foreground">Opened {fmtDate(r.createdAt)}</p>
                </li>
              )}
            </ol>
          )}
        </section>

        <p className="text-xs text-muted-foreground">Case stages update from what you record. A promise is not money received; record the application or refund only after you confirm it.</p>
        <div>
          <label htmlFor={`notes-${r.id}`} className="mb-1.5 block text-sm font-medium">Notes</label>
          <Textarea id={`notes-${r.id}`} rows={4} value={draft ?? r.notes} placeholder="Who you contacted, what they said…"
            onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
            onBlur={() => { if (draft !== null && draft !== r.notes) { actions.updateRecovery(r.id, { notes: draft }); setSaved(true); } setDraft(null); }} />
          <p role="status" className="mt-1 h-4 text-xs text-ok">{saved ? "Notes saved" : ""}</p>
        </div>
        {r.status !== "dismissed" && r.status !== "recovered" && r.status !== "credit_issued" && !f.promised && f.resolved.isZero() && <Button onClick={() => actions.updateRecovery(r.id, { status: "dismissed" })}>It was fine, dismiss</Button>}
      </div>
    </>
  );
}

function Figure({ label, hint, value, tone }: { label: string; hint: string; value: string; tone?: "ok" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`num mt-0.5 text-base font-semibold ${tone === "ok" ? "text-ok" : ""}`}>{value}</dd>
      <dd className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{hint}</dd>
    </div>
  );
}

function EventForm({ r, kind, outstanding, onSaved }: { r: RecoveryRecord; kind: Kind; outstanding: string; onSaved: () => void }) {
  const [date, setDate] = useState(kind === "promise" ? "" : today());
  const [text, setText] = useState("");
  const [amount, setAmount] = useState(kind === "promise" && r.confirmedAmount ? r.confirmedAmount : outstanding === "0.00" ? "" : outstanding);
  const [reference, setReference] = useState("");
  const [follow, setFollow] = useState("");
  const [error, setError] = useState("");
  const money = kind === "promise" || kind === "applied" || kind === "received";
  const textLabel = kind === "contacted" ? "How and what you asked (optional)" : kind === "reply" ? "What the vendor said" : "Details (optional)";
  const dateLabel = kind === "promise" ? "Expected date (optional)" : kind === "contacted" ? "Date you contacted them" : kind === "reply" ? "Date they replied" : kind === "applied" ? "Date applied" : "Date received";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input: EventInput =
      kind === "contacted" ? { kind, date, text, followUpDate: follow || undefined }
      : kind === "reply" ? { kind, date, text, followUpDate: follow || undefined }
      : kind === "promise" ? { kind, amount, date: date || undefined, text, reference }
      : { kind, date, amount, text, reference };
    const err = actions.recordRecoveryEvent(r.id, input);
    if (err) setError(err); else onSaved();
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl border bg-muted/30 p-3.5">
      {money && <Field label={`Amount (${r.currency})${kind === "promise" ? ": total the vendor agreed to" : ""}`} htmlFor={`ev-amt-${kind}`}><input id={`ev-amt-${kind}`} inputMode="decimal" className={fieldClass} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
      <Field label={dateLabel} htmlFor={`ev-date-${kind}`}><input id={`ev-date-${kind}`} type="date" className={fieldClass} value={date} max={kind === "promise" ? undefined : today()} onChange={(e) => setDate(e.target.value)} /></Field>
      {(kind === "promise" || kind === "applied" || kind === "received") && <Field label="Reference (optional): credit note, refund id, ticket" htmlFor={`ev-ref-${kind}`}><input id={`ev-ref-${kind}`} className={fieldClass} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} /></Field>}
      <Field label={textLabel} htmlFor={`ev-text-${kind}`}><Textarea id={`ev-text-${kind}`} rows={3} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} /></Field>
      {(kind === "contacted" || kind === "reply") && <Field label={kind === "contacted" ? "Follow up on (default: 7 days later)" : "Follow up on (optional)"} htmlFor={`ev-fu-${kind}`}><input id={`ev-fu-${kind}`} type="date" className={fieldClass} value={follow} onChange={(e) => setFollow(e.target.value)} /></Field>}
      {error && <motion.p role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-bad">{error}</motion.p>}
      <div className="flex justify-end gap-2"><Button onClick={onSaved}>Cancel</Button><Button variant="primary" onClick={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>Save to timeline</Button></div>
      <p className="text-xs text-muted-foreground"><StickyNote className="mr-1 inline size-3" aria-hidden />Saved on this device only, as your own record.</p>
    </form>
  );
}

/** Fixes a mistaken "applied" or "received" total. The earlier entry stays in the timeline and the correction is added next to it. */
function CorrectionForm({ r }: { r: RecoveryRecord }) {
  const f = caseFigures(r);
  const fields = [...(f.received.gt(0) ? [{ id: "received" as const, label: "Refund received", now: f.received }] : []), ...(f.applied.gt(0) ? [{ id: "applied" as const, label: "Credit applied", now: f.applied }] : [])];
  const [field, setField] = useState<"applied" | "received">(fields[0]?.id ?? "received");
  const current = fields.find((x) => x.id === field) ?? fields[0];
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (!current) return null;
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = actions.recordRecoveryEvent(r.id, { kind: "correct", field, amount: amount.trim(), text: reason });
    if (err) setError(err); else { setAmount(""); setReason(""); setError(""); }
  }
  return (
    <details className="rounded-xl border bg-card px-3.5 py-2.5">
      <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-medium">Entered the wrong amount? Correct it</summary>
      <form onSubmit={submit} className="mt-2 space-y-3 pb-2">
        <p className="text-xs text-muted-foreground">The original entry stays in the timeline and your correction is added beside it. If this reopens the case, it moves back to waiting for the rest.</p>
        {fields.length > 1 && (
          <Field label="Which amount" htmlFor={`fix-which-${r.id}`}>
            <select id={`fix-which-${r.id}`} className={fieldClass} value={field} onChange={(e) => setField(e.target.value as "applied" | "received")}>{fields.map((x) => <option key={x.id} value={x.id}>{x.label} (now {formatMoney(x.now.toFixed(2), r.currency)})</option>)}</select>
          </Field>
        )}
        <Field label={`Correct total for ${current.label.toLowerCase()} (${r.currency}), currently ${formatMoney(current.now.toFixed(2), r.currency)}`} htmlFor={`fix-amt-${r.id}`}><input id={`fix-amt-${r.id}`} inputMode="decimal" className={fieldClass} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 10.00" /></Field>
        <Field label="What was wrong" htmlFor={`fix-why-${r.id}`}><Textarea id={`fix-why-${r.id}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I typed 100 instead of 10" /></Field>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end"><Button type="button" variant="primary" disabled={!amount.trim() || !reason.trim()} onClick={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>Save correction</Button></div>
      </form>
    </details>
  );
}
