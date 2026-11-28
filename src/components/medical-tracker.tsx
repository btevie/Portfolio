"use client";
import Link from "next/link";
import { useState } from "react";
import { CalendarPlus, ClipboardCheck, Copy, FileText, Lock, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/audit/money";
import { today } from "@/lib/data/selectors";
import { actions, useAppState } from "@/lib/data/store";
import { deadlinesCalendar } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { buildMedicalRequest, CHECKS, deadlineState, deadlineWhen, emptyMedical, GLOSSARY, insurerGap, needsChecks, nextStep, type RequestKind } from "@/lib/medical-tracking";
import type { Invoice } from "@/lib/types";
import { Button, Disclosure, Field, fieldClass, Modal } from "@/components/ui";

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * What the person has checked on a medical bill, what their insurer's statement says they owe, drafted requests and dates.
 * "Checked" never means "correct". Nothing is sent anywhere: drafts are text to copy.
 */
export function MedicalTracker({ inv }: { inv: Invoice }) {
  const state = useAppState();
  const m = state.medicalBills?.[inv.id] ?? emptyMedical();
  const asOf = today();
  const gap = insurerGap(inv, m, asOf);
  const step = nextStep(inv, m, asOf);
  const held = needsChecks(m);
  const [figure, setFigure] = useState(m.patientResponsibility ?? "");
  const [stmtDate, setStmtDate] = useState(m.statementDate ?? "");
  const [figureError, setFigureError] = useState("");
  const [person, setPerson] = useState(m.forPerson ?? "");
  const [draft, setDraft] = useState<{ kind: RequestKind; text: string; notes: string[]; subject: string } | null>(null);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [withFigure, setWithFigure] = useState(false);
  const [dl, setDl] = useState({ date: "", label: "", source: "" });
  const [dlError, setDlError] = useState("");

  const tick = (field: (typeof CHECKS)[number]["field"], on: boolean) => actions.updateMedical(inv.id, { [field]: on ? asOf : undefined });
  const money = (v: string) => formatMoney(v, inv.currency);

  function open(kind: RequestKind, includeFigure = withFigure) {
    const r = buildMedicalRequest(kind, inv, m, state.user.name, { includeStatementFigure: includeFigure });
    setDraft({ kind, text: `Subject: ${r.subject}\n\n${r.message}`, notes: r.notes, subject: r.subject }); setCopied(null);
  }
  function saveFigure() {
    const e = actions.updateMedical(inv.id, { patientResponsibility: figure.trim(), statementDate: stmtDate });
    setFigureError(e ?? "");
  }
  function addDeadline(e: React.FormEvent) {
    e.preventDefault();
    const err = actions.addMedicalDeadline(inv.id, dl);
    if (err) setDlError(err); else { setDl({ date: "", label: "", source: "" }); setDlError(""); }
  }
  const deadlines = [...m.deadlines].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section aria-label="Your checks on this medical bill" className="mb-5 space-y-4 rounded-2xl bg-card p-4 ring-1 ring-line sm:p-5" data-testid="medical-tracker">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><ClipboardCheck className="size-5 text-sky-600" aria-hidden />Your checks on this bill</h2>
        <p className="mt-1 text-xs text-muted-foreground">Stays on this device. Overbill never contacts your provider or insurer, and a tick means you checked something, not that the bill is correct.</p>
      </div>

      <div className="rounded-xl bg-muted/50 p-3.5" aria-label="Next step">
        <p className="text-xs font-medium text-muted-foreground">Next step</p>
        <p className="mt-0.5 text-sm font-semibold">{step.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>
        {(step.key === "itemised" || step.key === "ask_difference") && <Button size="sm" variant="primary" className="mt-3 min-h-11 w-full sm:w-auto" onClick={() => open("itemised", step.key === "ask_difference")}><FileText className="size-4" aria-hidden />{step.key === "itemised" ? "Draft a request for an itemised bill" : "Draft a request to explain the difference"}</Button>}
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Checklist</legend>
        <div className="space-y-2">
          {CHECKS.map((c) => (
            <label key={c.key} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" checked={Boolean(m[c.field])} onChange={(e) => tick(c.field, e.target.checked)} />
              <span><span className="font-medium">{c.label}</span>{m[c.field] && <span className="text-muted-foreground"> · ticked by you on {fmtDate(m[c.field]!)}</span>}<span className="block text-xs text-muted-foreground">{c.why}</span></span>
            </label>
          ))}
        </div>
        {held && (
          <div className="mt-2 rounded-xl bg-warn-bg px-3.5 py-3 text-sm text-warn ring-1 ring-warn-line" role="status">
            <p>This bill waits on the pay run until both are ticked. It is due {fmtDate(inv.dueDate)}, so don&apos;t let it slip past that date without deciding what to do.</p>
            <Button size="sm" className="mt-2 min-h-11" onClick={() => actions.updateMedical(inv.id, { payAnywayOn: asOf })}>I&apos;ll pay without these checks</Button>
          </div>
        )}
        {m.payAnywayOn && !held && <p className="mt-2 text-xs text-muted-foreground">You chose on {fmtDate(m.payAnywayOn)} to pay without every check. <button type="button" className="min-h-11 cursor-pointer font-medium text-primary hover:underline" onClick={() => actions.updateMedical(inv.id, { payAnywayOn: undefined })}>Undo</button></p>}
      </fieldset>

      <div>
        <h3 className="text-sm font-semibold">What your insurer&apos;s statement says you owe</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Look for &ldquo;patient responsibility&rdquo; on the statement (EOB). Type it in; Overbill compares two numbers and reads nothing from your insurer.</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label={`Patient responsibility (${inv.currency})`} htmlFor={`med-pr-${inv.id}`}><input id={`med-pr-${inv.id}`} inputMode="decimal" className={fieldClass} value={figure} onChange={(e) => setFigure(e.target.value)} placeholder="e.g. 120.50" /></Field>
          <Field label="Date on the statement" htmlFor={`med-sd-${inv.id}`}><input id={`med-sd-${inv.id}`} type="date" max={asOf} className={fieldClass} value={stmtDate} onChange={(e) => setStmtDate(e.target.value)} /></Field>
        </div>
        <div className="mt-2 flex items-center gap-3"><Button size="sm" onClick={saveFigure}>Save</Button>{figureError && <p role="alert" className="text-sm text-bad">{figureError}</p>}</div>
        {gap && (
          <div role="status" className={`mt-3 rounded-xl px-3.5 py-3 text-sm ring-1 ${gap.kind === "bill_higher" ? "bg-warn-bg text-warn ring-warn-line" : "bg-muted/50 ring-line"}`}>
            <p className="font-medium">{gap.kind === "bill_higher" ? `Bill is ${money(gap.amount.toFixed(2))} higher than your statement` : gap.kind === "bill_lower" ? `Bill is ${money(gap.amount.toFixed(2))} lower than your statement` : "These match"}</p>
            <p className="mt-1 text-foreground/80">{gap.text}</p>
            <p className="mt-1 text-xs text-muted-foreground">How: bill total {money(inv.total)} minus patient responsibility {money(m.patientResponsibility!)}. Nothing here is confirmed.</p>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Draft a request (you send it)</h3>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Button size="sm" className="min-h-11" onClick={() => open("itemised")}>Ask for an itemised bill</Button>
          <Button size="sm" className="min-h-11" onClick={() => open("hold")}>Request a hold (not a legal stay)</Button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Dates to remember</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Appeal windows, payment plans, collection notices. Overbill never works a date out: enter it from the letter and say where it came from.</p>
        {deadlines.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No dates entered. That does not mean there are none: check your letters.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {deadlines.map((d) => { const st = deadlineState(d, asOf); return (
              <li key={d.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0"><span className={`font-medium ${st.status === "overdue" ? "text-bad" : ""}`}>{d.label}: {fmtDate(d.date)}</span> <span className="text-muted-foreground">({deadlineWhen(st.days)})</span>
                  <span className="block text-xs text-muted-foreground">Source you gave: {d.source}. Entered {fmtDate(d.addedOn)}. Check it against the original letter.</span></span>
                <button type="button" aria-label={`Remove ${d.label}`} onClick={() => actions.removeMedicalDeadline(inv.id, d.id)} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-bad"><Trash2 className="size-4" aria-hidden /></button>
              </li>); })}
          </ul>
        )}
        <form onSubmit={addDeadline} className="mt-2 grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Date" htmlFor={`dl-d-${inv.id}`}><input id={`dl-d-${inv.id}`} type="date" className={fieldClass} value={dl.date} onChange={(e) => setDl({ ...dl, date: e.target.value })} /></Field>
          <Field label="What it is for" htmlFor={`dl-l-${inv.id}`}><input id={`dl-l-${inv.id}`} className={fieldClass} maxLength={120} value={dl.label} onChange={(e) => setDl({ ...dl, label: e.target.value })} placeholder="e.g. appeal window ends" /></Field>
          <div className="sm:col-span-2"><Field label="Where this date came from" htmlFor={`dl-s-${inv.id}`}><input id={`dl-s-${inv.id}`} className={fieldClass} maxLength={200} value={dl.source} onChange={(e) => setDl({ ...dl, source: e.target.value })} placeholder="e.g. collection letter dated 3 Nov" /></Field></div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><Button size="sm" type="button" onClick={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>Add date</Button>
            {deadlines.length > 0 && <button type="button" className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline" onClick={() => download("overbill-medical-dates.ics", deadlinesCalendar(deadlines.map((d) => ({ ...d, title: `${inv.vendorName} ${inv.number}` }))), "text/calendar")}><CalendarPlus className="size-4" aria-hidden />Add to my calendar (.ics)</button>}
            {dlError && <p role="alert" className="text-sm text-bad">{dlError}</p>}</div>
        </form>
      </div>

      <Field label="Whose bill is this? (optional)" htmlFor={`med-who-${inv.id}`} hint="For your own sorting. It is never put into a drafted request.">
        <input id={`med-who-${inv.id}`} className={fieldClass} maxLength={60} value={person} onChange={(e) => setPerson(e.target.value)} onBlur={() => actions.updateMedical(inv.id, { forPerson: person.trim() })} placeholder="me, or a first name" />
      </Field>

      <div className="rounded-xl bg-muted/50 p-3.5 text-sm" role="note">
        <p className="flex items-center gap-2 font-medium"><Lock className="size-4 text-sky-600" aria-hidden />Medical details are sensitive</p>
        <p className="mt-1 text-muted-foreground">They are saved unencrypted in this browser, so anyone who uses this browser profile could read them. Don&apos;t use Overbill for medical bills on a shared or public computer. <Link href="/data" className="font-medium text-primary hover:underline">Make an encrypted backup</Link> so you can keep a locked copy. Don&apos;t put diagnoses or patient numbers in notes.</p>
      </div>

      <Disclosure title="What these words mean" subtitle="Plain-language, not advice">
        <dl className="divide-y divide-line px-5">{GLOSSARY.map((g) => <div key={g.term} className="py-2.5"><dt className="text-sm font-medium">{g.term}</dt><dd className="mt-0.5 text-sm text-muted-foreground">{g.meaning}</dd></div>)}</dl>
      </Disclosure>

      <Modal open={draft !== null} onClose={() => setDraft(null)} title={draft?.kind === "hold" ? "Request a hold" : "Request an itemised bill"} wide>
        {draft && (
          <div className="space-y-3">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{draft.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            {m.patientResponsibility && <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-[var(--primary)]" checked={withFigure} onChange={(e) => { setWithFigure(e.target.checked); open(draft.kind, e.target.checked); }} />Mention what my insurer&apos;s statement says I owe ({money(m.patientResponsibility)})</label>}
            <label htmlFor="med-draft" className="sr-only">Draft request</label>
            <textarea id="med-draft" rows={14} className={`${fieldClass} h-auto font-mono text-sm leading-relaxed`} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" className="min-h-11" onClick={async () => { try { await navigator.clipboard.writeText(draft.text); setCopied("ok"); } catch { setCopied("fail"); } }}><Copy className="size-4" aria-hidden />Copy</Button>
              <Button className="min-h-11" onClick={() => setDraft(null)}>Close</Button>
              <span role="status" className={`text-sm ${copied === "fail" ? "text-bad" : "text-muted-foreground"}`}>{copied === "ok" ? "Copied. Nothing was sent." : copied === "fail" ? "Couldn't copy. Select the text and copy it yourself." : ""}</span>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
