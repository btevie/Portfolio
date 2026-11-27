"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CircleCheck, Link2, Link2Off, Undo2 } from "lucide-react";
import { D, formatMoney } from "@/lib/audit/money";
import { billLabel, creditPosition, CREDIT_STATUS_LABEL, linkCandidates, type CreditPosition, type CreditStatus } from "@/lib/credits";
import { actions, useAppState } from "@/lib/data/store";
import { fmtDate } from "@/lib/format";
import type { CreditEvent, Invoice } from "@/lib/types";
import { Button, Card, Field, fieldClass, Pill, SectionHeader } from "@/components/ui";
import { SelectMenu } from "@/components/ui/select-menu";
import { Textarea } from "@/components/ui/textarea";

const TONE: Record<CreditStatus, "warn" | "info" | "ok"> = { unmatched: "warn", awaiting: "info", partial: "info", settled: "ok" };

export function CreditStatusPill({ status }: { status: CreditStatus }) {
  return <Pill tone={TONE[status]}>{CREDIT_STATUS_LABEL[status]}</Pill>;
}

const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`num mt-0.5 text-base font-semibold ${tone ?? ""}`}>{value}</dd></div>;
}

/** Everything about one credit note: where it stands, which bill it relates to, what the user confirmed, and the full history. */
export function CreditTracker({ credit }: { credit: Invoice }) {
  const state = useAppState();
  const pos = creditPosition(state, credit);
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, credit.currency);
  const history = pos.record?.events ?? [];

  return (
    <section aria-labelledby="credit-h" className="mb-4 space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="credit-h" className="text-base font-semibold tracking-tight">Where this credit stands</h2>
          <CreditStatusPill status={pos.status} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Figure label="Credit note" value={m(pos.total)} />
          <Figure label="Confirmed applied to bills" value={m(pos.applied)} tone="text-ok" />
          <Figure label="Confirmed refunded" value={m(pos.refunded)} tone="text-ok" />
          <Figure label="Still unaccounted for" value={m(pos.remaining)} tone={pos.remaining.gt(0) ? "text-warn" : "text-ok"} />
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">
          A credit note being issued does not mean you got the money. Only amounts you confirm below count as applied or refunded. Credit notes are never added to what you owe or to your spending totals.
        </p>
      </Card>

      <MatchCard pos={pos} />
      {pos.remaining.gt(0) && <SettleCard pos={pos} />}
      <HistoryCard pos={pos} events={history} />
    </section>
  );
}

function MatchCard({ pos }: { pos: CreditPosition }) {
  const state = useAppState();
  const { credit, related } = pos;
  const options = useMemo(() => linkCandidates(state, credit), [state, credit]);
  const [pick, setPick] = useState("");
  const [err, setErr] = useState("");
  const chosen = pick || options[0]?.id || "";

  function link() {
    const r = actions.linkCredit(credit.id, chosen);
    setErr(r.ok ? "" : r.error); if (r.ok) setPick("");
  }

  return (
    <Card>
      <SectionHeader title="1. Which bill does it relate to?" description="Pick the invoice this credit corrects, or the later bill it should come off. This only records the relationship." />
      <div className="px-5 pb-5">
        {related ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-3">
            <p className="flex items-center gap-2 text-sm"><Link2 className="size-4 text-primary" aria-hidden />Linked to <Link href={`/invoices/${related.id}`} className="font-semibold text-primary hover:underline">{billLabel(related)}</Link><span className="num text-muted-foreground">({formatMoney(related.total, related.currency)}, {fmtDate(related.date)})</span></p>
            <Button size="sm" onClick={() => { const r = actions.linkCredit(credit.id, null); setErr(r.ok ? "" : r.error); }}><Link2Off className="size-3.5" aria-hidden />Unlink</Button>
          </div>
        ) : options.length === 0 ? (
          <p role="status" className="rounded-xl bg-warn-bg px-3 py-3 text-sm text-warn">No {credit.currency} bills from {credit.vendorName} have been added yet, so there is nothing to match. Add the related invoice, then come back. This credit stays in your unmatched list until then.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Field label="Related bill" htmlFor="credit-link">
                <SelectMenu id="credit-link" label="Related bill" value={chosen} onChange={setPick} searchable={options.length > 8}
                  options={options.map((i) => ({ value: i.id, label: `${i.number} · ${fmtDate(i.date)} · ${formatMoney(i.total, i.currency)}` }))} />
              </Field>
            </div>
            <Button variant="primary" onClick={link}><Link2 className="size-4" aria-hidden />Link to this bill</Button>
          </div>
        )}
        {err && <p role="alert" className="mt-2 text-sm text-bad">{err}</p>}
      </div>
    </Card>
  );
}

function SettleCard({ pos }: { pos: CreditPosition }) {
  const state = useAppState();
  const { credit } = pos;
  const bills = useMemo(() => linkCandidates(state, credit), [state, credit]);
  const [kind, setKind] = useState<"applied" | "refunded">("applied");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [reference, setReference] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const target = appliedTo || pos.related?.id || bills[0]?.id || "";
  const amt = amount || pos.remaining.toFixed(2);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = actions.recordCreditSettlement(credit.id, { kind, amount: amt, date, reference, appliedToId: kind === "applied" ? target : undefined, note, confirmed });
    if (!r.ok) { setErr(r.error); setDone(""); return; }
    setErr(""); setDone(`Recorded ${formatMoney(amt, credit.currency)} as ${kind === "applied" ? "applied to a bill" : "refunded"}.`);
    setAmount(""); setReference(""); setNote(""); setConfirmed(false);
  }

  return (
    <Card>
      <SectionHeader title="2. Did you actually get the money?" description={`${formatMoney(pos.remaining, credit.currency)} is still unaccounted for. Record it only once you have seen it on a statement, bank line or the vendor's account.`} />
      <form onSubmit={submit} className="space-y-3 px-5 pb-5">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">What happened</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([["applied", "Applied to a bill", "The vendor took it off an invoice you owe or paid."], ["refunded", "Refunded to me", "The money was paid back to you."]] as const).map(([v, label, hint]) => (
              <label key={v} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${kind === v ? "border-primary bg-primary/5" : "border-line"}`}>
                <input type="radio" name="credit-kind" className="mt-0.5 size-4 accent-[var(--primary)]" checked={kind === v} onChange={() => setKind(v)} />
                <span><span className="block font-medium">{label}</span><span className="text-xs text-muted-foreground">{hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === "applied" && (
            <div className="sm:col-span-2">
              <Field label="Applied to which bill?" htmlFor="credit-applied-to">
                <SelectMenu id="credit-applied-to" label="Applied to which bill" value={target} onChange={setAppliedTo} searchable={bills.length > 8}
                  options={bills.map((i) => ({ value: i.id, label: `${i.number} · ${fmtDate(i.date)} · ${formatMoney(i.total, i.currency)}` }))} />
              </Field>
              {bills.length === 0 && <p className="mt-1 text-xs text-warn">There is no bill from this vendor to apply it to yet. Add one first, or record a refund instead.</p>}
            </div>
          )}
          <Field label={`Amount (${credit.currency})`} htmlFor="credit-amount" hint="Up to what is still unaccounted for"><input id="credit-amount" inputMode="decimal" className={fieldClass} value={amt} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Date it happened" htmlFor="credit-date" hint="YYYY-MM-DD"><input id="credit-date" className={fieldClass} value={date} onChange={(e) => setDate(e.target.value)} placeholder="2026-12-01" /></Field>
          <div className="sm:col-span-2"><Field label="Evidence reference" htmlFor="credit-ref" hint="Refund ID, remittance advice number, statement line…"><input id="credit-ref" className={fieldClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} /></Field></div>
          <div className="sm:col-span-2"><Field label="Note (optional)" htmlFor="credit-note"><Textarea id="credit-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        </div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" />
          <span>I checked my statement, bank or the vendor&apos;s account and this really happened.</span>
        </label>
        <div role="alert" className="min-h-5 text-sm text-bad">{err}</div>
        <div role="status" className="text-sm text-ok">{done}</div>
        <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!confirmed}><CircleCheck className="size-4" aria-hidden />Record confirmed {kind === "applied" ? "application" : "refund"}</Button></div>
      </form>
    </Card>
  );
}

const KIND_LABEL: Record<CreditEvent["kind"], string> = { linked: "Linked", unlinked: "Unlinked", applied: "Applied", refunded: "Refunded", reversed: "Reversed", note: "Note" };

function HistoryCard({ pos, events }: { pos: CreditPosition; events: CreditEvent[] }) {
  const [rev, setRev] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const liveIds = new Set(pos.live.map((e) => e.id));
  const reversedBy = new Map(events.filter((e) => e.kind === "reversed" && e.reverses).map((e) => [e.reverses!, e]));
  const m = (v: string) => formatMoney(v, pos.credit.currency);

  return (
    <Card>
      <SectionHeader title="History and evidence" description="Every change is kept. A mistake is reversed, never erased." />
      <div className="px-5 pb-5">
        {events.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet. This credit has been issued, but nothing has been confirmed.</p> : (
          <ol className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2"><Pill tone={e.kind === "applied" || e.kind === "refunded" ? "ok" : e.kind === "reversed" ? "warn" : "neutral"}>{KIND_LABEL[e.kind]}</Pill>{e.amount && <span className="num font-semibold">{m(e.amount)}</span>}{reversedBy.has(e.id) && <Pill tone="warn">Reversed</Pill>}</p>
                  <time dateTime={e.at} className="text-xs text-muted-foreground">Recorded {fmtDate(e.at.slice(0, 10))}</time>
                </div>
                <p className={`mt-1.5 ${reversedBy.has(e.id) ? "text-muted-foreground line-through" : ""}`}>{e.text}</p>
                {(e.date || e.reference) && <p className="mt-1 text-xs text-muted-foreground">{e.date && <>Happened {fmtDate(e.date)}</>}{e.date && e.reference && " · "}{e.reference && <>Evidence: <span className="font-medium text-foreground">{e.reference}</span></>}</p>}
                {liveIds.has(e.id) && (rev === e.id ? (
                  <div className="mt-2 space-y-2">
                    <label htmlFor={`rev-${e.id}`} className="block text-xs font-medium">Why are you reversing this?</label>
                    <input id={`rev-${e.id}`} className={fieldClass} value={reason} onChange={(ev) => setReason(ev.target.value)} />
                    {err && <p role="alert" className="text-sm text-bad">{err}</p>}
                    <div className="flex gap-2"><Button size="sm" onClick={() => { const r = actions.reverseCreditSettlement(pos.credit.id, e.id, reason); if (r.ok) { setRev(null); setReason(""); setErr(""); } else setErr(r.error); }}>Reverse this entry</Button><Button size="sm" variant="ghost" onClick={() => { setRev(null); setErr(""); }}>Cancel</Button></div>
                  </div>
                ) : <Button size="sm" className="mt-2" onClick={() => { setRev(e.id); setReason(""); setErr(""); }}><Undo2 className="size-3.5" aria-hidden />Entered by mistake? Reverse</Button>)}
              </li>
            ))}
          </ol>
        )}
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const r = actions.addCreditNote(pos.credit.id, note); if (r.ok) setNote(""); }}>
          <div className="min-w-56 flex-1"><Field label="Add a note" htmlFor="credit-hist-note"><input id="credit-hist-note" className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Asked the vendor to apply it on 3 Dec" /></Field></div>
          <Button type="submit" disabled={!note.trim()}>Add note</Button>
        </form>
      </div>
    </Card>
  );
}

/** On a bill: credit notes linked to it, so the connection is visible from both sides. Read-only; it never changes what is owed. */
export function LinkedCredits({ bill }: { bill: Invoice }) {
  const state = useAppState();
  const linked = state.invoices.filter((i) => i.isCredit).map((c) => creditPosition(state, c)).filter((p) => p.related?.id === bill.id || p.live.some((e) => e.invoiceId === bill.id));
  if (linked.length === 0) return null;
  return (
    <section aria-labelledby="linked-credits-h" className="mb-4">
      <Card className="p-4 sm:p-5">
        <h2 id="linked-credits-h" className="text-base font-semibold tracking-tight">Credit notes linked to this bill</h2>
        <p className="mt-1 text-sm text-muted-foreground">The amount shown above is still the invoice total. Credits are shown here for reference and are not subtracted from what you owe.</p>
        <ul className="mt-3 divide-y divide-line">
          {linked.map((p) => {
            const onThis = p.live.filter((e) => e.kind === "applied" && e.invoiceId === bill.id).reduce((a, e) => a.plus(e.amount ?? 0), D(0));
            return (
              <li key={p.credit.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <Link href={`/invoices/${p.credit.id}`} className="font-medium text-primary hover:underline">Credit note {p.credit.number}</Link>
                <span className="num text-muted-foreground">{formatMoney(p.total, p.credit.currency)}{onThis.gt(0) && <> · {formatMoney(onThis, p.credit.currency)} confirmed applied here</>}</span>
                <CreditStatusPill status={p.status} />
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
