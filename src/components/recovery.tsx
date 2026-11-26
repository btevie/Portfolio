"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PiggyBank, Plus } from "lucide-react";
import { D, formatMoney, isValidDecimal } from "@/lib/audit/money";
import { recoveryStats } from "@/lib/data/selectors";
import { actions, useAppState } from "@/lib/data/store";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import type { RecoveryStatus } from "@/lib/types";
import { Button, Card, EmptyState, Field, fieldClass, Modal, PageHeader, Pill } from "@/components/ui";

const STATUSES = Object.keys(STATUS_LABEL) as RecoveryStatus[];
const tone = (s: RecoveryStatus) => (s === "recovered" || s === "credit_issued" ? "ok" : s === "dismissed" ? "neutral" : s === "flagged" ? "warn" : "primary") as "ok" | "neutral" | "warn" | "primary";

export function Recovery() {
  const state = useAppState();
  const cur = state.settings.currency;
  const stats = useMemo(() => recoveryStats(state.recovery, cur), [state.recovery, cur]);
  const [filter, setFilter] = useState<"all" | RecoveryStatus>("all");
  const [adding, setAdding] = useState(false);
  const rows = state.recovery.filter((r) => filter === "all" || r.status === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const count = (s: RecoveryStatus) => state.recovery.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader title="Recovery tracker" description="Follow every flagged amount from first suspicion to money back — or to 'it was fine'." actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden />Add record</Button>} />
      <section aria-label="Recovery figures" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {([["Potential savings", formatMoney(stats.potential, cur), "Flagged, disputed or awaiting a reply", ""], ["Disputed", formatMoney(stats.disputed, cur), "With the vendor right now", ""], ["Confirmed recovered", formatMoney(stats.recovered, cur), "Refunded to you", "text-ok"], ["Recovery success rate", stats.rate === null ? "—" : `${stats.rate}%`, stats.resolved ? `${stats.won} of ${stats.resolved} resolved cases paid out` : "No resolved cases yet", ""]] as const).map(([k, v, h, c]) => (
          <Card key={k} className="p-5"><p className="text-[13px] font-medium text-muted">{k}</p><p className={`num mt-2 text-[28px] leading-none font-semibold tracking-tight ${c}`}>{v}</p><p className="mt-2 text-xs text-muted">{h}</p></Card>
        ))}
      </section>

      <div role="group" aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {(["all", ...STATUSES] as const).map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)} className={`h-8 cursor-pointer rounded-full border px-3 text-[13px] font-medium transition-colors duration-150 ${filter === s ? "border-primary bg-primary text-white" : "border-line-strong bg-surface text-muted hover:text-ink"}`}>
            {s === "all" ? `All (${state.recovery.length})` : `${STATUS_LABEL[s]} (${count(s)})`}
          </button>
        ))}
      </div>

      {state.recovery.length === 0 ? (
        <Card><EmptyState icon={PiggyBank} title="Nothing to recover — yet">When an invoice finding has money at stake, track it here from flagged to recovered.</EmptyState></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={PiggyBank} title="No records in this status">Pick another status above.</EmptyState></Card>
      ) : (
        <ul className="space-y-3">{rows.map((r) => <RecordCard key={r.id} id={r.id} />)}</ul>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add recovery record"><AddForm onDone={() => setAdding(false)} /></Modal>
    </>
  );
}

function RecordCard({ id }: { id: string }) {
  const state = useAppState();
  const r = state.recovery.find((x) => x.id === id)!;
  const [draft, setNotes] = useState<string | null>(null);
  const notes = draft ?? r.notes;
  const [saved, setSaved] = useState(false);
  return (
    <li>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2"><Pill tone={tone(r.status)}>{STATUS_LABEL[r.status]}</Pill></div>
            <h3 className="text-[15px] font-semibold">{r.title}</h3>
            <p className="mt-0.5 text-[13px] text-muted">
              {r.vendorId ? <Link href={`/vendors/${r.vendorId}`} className="hover:underline">{r.vendorName}</Link> : r.vendorName}
              {r.invoiceId && <> · <Link href={`/invoices/${r.invoiceId}${r.findingId ? `?finding=${encodeURIComponent(r.findingId)}` : ""}`} className="text-primary hover:underline">View invoice</Link></>}
              {" "}· Opened {fmtDate(r.createdAt)} · Updated {fmtDate(r.updatedAt)}
            </p>
          </div>
          <div className="text-right"><p className="num text-xl font-semibold">{formatMoney(r.amount, r.currency)}</p></div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_220px]">
          <div>
            <label htmlFor={`notes-${r.id}`} className="mb-1.5 block text-[13px] font-medium">Notes</label>
            <textarea id={`notes-${r.id}`} rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} onBlur={() => { if (draft !== null && draft !== r.notes) { actions.updateRecovery(r.id, { notes: draft }); setSaved(true); } setNotes(null); }} className="w-full rounded-md border border-line-strong p-2.5 text-sm" placeholder="Who you contacted, what they said…" />
            <p role="status" className="h-4 text-xs text-ok">{saved ? "Notes saved" : ""}</p>
          </div>
          <div>
            <label htmlFor={`status-${r.id}`} className="mb-1.5 block text-[13px] font-medium">Status</label>
            <select id={`status-${r.id}`} value={r.status} onChange={(e) => actions.updateRecovery(r.id, { status: e.target.value as RecoveryStatus })} className={fieldClass}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
      </Card>
    </li>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const state = useAppState();
  const [v, setV] = useState({ vendorId: state.vendors[0]?.id ?? "", title: "", amount: "", notes: "" });
  const [err, setErr] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const vendor = state.vendors.find((x) => x.id === v.vendorId);
    if (!vendor || !v.title.trim() || !isValidDecimal(v.amount) || D(v.amount).lte(0)) { setErr("Choose a vendor, add a short title and enter a positive amount."); return; }
    actions.addRecovery({ vendorId: vendor.id, vendorName: vendor.name, title: v.title.trim(), amount: D(v.amount).toFixed(2), currency: state.settings.currency, notes: v.notes });
    onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Vendor" htmlFor="add-vendor"><select id="add-vendor" className={fieldClass} value={v.vendorId} onChange={(e) => setV({ ...v, vendorId: e.target.value })}>{state.vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="What happened" htmlFor="add-title"><input id="add-title" className={fieldClass} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. Charged after cancellation" /></Field>
      <Field label={`Amount (${state.settings.currency})`} htmlFor="add-amount"><input id="add-amount" inputMode="decimal" className={fieldClass} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
      <Field label="Notes" htmlFor="add-notes"><textarea id="add-notes" rows={3} className="w-full rounded-md border border-line-strong p-2.5 text-sm" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button onClick={onDone}>Cancel</Button><Button variant="primary" onClick={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>Add record</Button></div>
    </form>
  );
}
