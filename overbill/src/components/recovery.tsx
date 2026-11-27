"use client";
import { SelectMenu } from "@/components/ui/select-menu";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, PiggyBank, Plus, RotateCcw } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { D, formatMoney, isValidDecimal } from "@/lib/audit/money";
import { daysBetween, parseISO } from "@/lib/audit/normalize";
import { pendingCreditNote, recoveryStats, today } from "@/lib/data/selectors";
import { Textarea } from "@/components/ui/textarea";
import { CaseDetail } from "@/components/recovery-case";
import { nextAction } from "@/lib/recovery";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { actions, useAppState } from "@/lib/data/store";
import { initials, STATUS_LABEL } from "@/lib/format";
import type { RecoveryRecord, RecoveryStatus } from "@/lib/types";
import { savingsReportHtml } from "@/lib/report";
import { auditAll } from "@/lib/data/selectors";
import { Button, Card, Disclosure, EmptyState, Field, fieldClass, Modal, PageHeader, ProgressRing, Stat } from "@/components/ui";

type Stage = Exclude<RecoveryStatus, "dismissed">;
const EASE = [0.23, 1, 0.32, 1] as const;

/** The pipeline. Colour carries meaning: amber needs you, slate is with the vendor, green is money back. */
const STAGES: { id: Stage; label: string; hint: string; bar: string; dot: string }[] = [
  { id: "flagged", label: "Flagged", hint: "Spotted, not raised yet", bar: "bg-warn", dot: "bg-warn" },
  { id: "disputed", label: "Disputed", hint: "Raised with the vendor", bar: "bg-muted-foreground", dot: "bg-muted-foreground" },
  { id: "vendor_responded", label: "Vendor replied", hint: "Their answer is in", bar: "bg-muted-foreground/50", dot: "bg-muted-foreground/50" },
  { id: "credit_issued", label: "Credit issued", hint: "Promised, not applied yet", bar: "bg-ok/50", dot: "bg-ok/50" },
  { id: "recovered", label: "Recovered", hint: "Money is back", bar: "bg-ok", dot: "bg-ok" },
];

/** One click to the next stage. */
const NEXT: Partial<Record<RecoveryStatus, { to: RecoveryStatus; label: string }>> = {
  flagged: { to: "disputed", label: "Mark as disputed" },
  disputed: { to: "vendor_responded", label: "Vendor replied" },
};
/** Steps that involve money are recorded in the case (with an amount and date), never moved with one click. */
const OPEN_CASE: Partial<Record<RecoveryStatus, string>> = { vendor_responded: "Record promise or credit", credit_issued: "Record credit or refund" };

const ago = (iso: string) => {
  const d = daysBetween(parseISO(iso) ?? 0, parseISO(today()) ?? 0);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(m.matches);
    on(); m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

export function Recovery() {
  const state = useAppState();
  const cur = state.settings.currency;
  const stats = useMemo(() => recoveryStats(state.recovery, cur), [state.recovery, cur]);
  function openReport(redact: boolean) {
    const html = savingsReportHtml(state, auditAll(state), { redact });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  const wide = useWide();
  const recShare = Number(stats.recovered.plus(stats.potential).gt(0) ? stats.recovered.div(stats.recovered.plus(stats.potential)).times(100) : 0);
  const [adding, setAdding] = useState(false);
  const sp = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(sp.get("case")); // /recovery?case=<id> opens that case (linked from the invoice finding)
  const [stage, setStage] = useState<"all" | Stage>("all");

  const open = state.recovery.filter((r) => r.status !== "dismissed").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const dismissed = state.recovery.filter((r) => r.status === "dismissed");
  const inStage = (s: Stage) => open.filter((r) => r.status === s);
  const total = (rs: RecoveryRecord[]) => rs.filter((r) => r.currency === cur).reduce((a, r) => a.plus(D(r.amount)), D(0));
  const list = stage === "all" ? open : inStage(stage);
  const otherCur = open.filter((r) => r.currency !== cur);

  return (
    <>
      <PageHeader title="Recovery tracker" description="After you dispute a flagged charge, track it here until the money is back. Amounts are claims you are making, not money received, until you mark a case “Money received”." actions={<><Button onClick={() => openReport(false)}>Savings report</Button><Button onClick={() => openReport(true)} title="Vendor names and case titles are hidden">Share-safe report</Button><Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden />Add case</Button></>} />
      {otherCur.length > 0 && (
        <p role="note" className="mb-3 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          {otherCur.length} open case{otherCur.length === 1 ? " is" : "s are"} in other currencies, so {otherCur.length === 1 ? "it isn't" : "they aren't"} in the {cur} totals below: {[...new Set(otherCur.map((r) => r.currency))].map((c) => `${formatMoney(otherCur.filter((r) => r.currency === c).reduce((t, r) => t.plus(D(r.amount)), D(0)), c)}`).join(" · ")}. Overbill never converts currencies.
        </p>
      )}

      <Card role="region" aria-label="Recovery figures" className="mb-4 grid grid-cols-2 max-sm:[&>div:nth-child(2)]:hidden max-sm:[&>div:nth-child(4)]:hidden xl:grid-cols-4 [&>div]:border-b [&>div]:border-line [&>div:nth-child(odd)]:border-r xl:[&>div]:border-b-0 xl:[&>div:not(:last-child)]:border-r">
        {([
          ["Potential savings", Number(stats.potential), (n: number) => formatMoney(n, cur), "Claimed but not received yet. Not money in hand", undefined],
          ["Disputed", Number(stats.disputed), (n: number) => formatMoney(n, cur), "With the vendor right now", undefined],
          ["Money received", Number(stats.recovered), (n: number) => formatMoney(n, cur), (stats.recovered.gt(0) ? `${formatMoney(stats.received, cur)} refunded · ${formatMoney(stats.applied, cur)} credit applied · ` : "") + (pendingCreditNote(stats, (d) => formatMoney(d, cur)) ?? "Self-reported by you"), "ok"],
          ["Cases that paid out", stats.rate ?? 0, (n: number) => (stats.rate === null ? "—" : `${Math.round(n)}%`), (stats.resolved ? `${stats.won} of ${stats.resolved} closed cases paid out` : "No closed cases yet") + (stats.pendingCreditCount ? ` · ${stats.pendingCreditCount} credit pending, not counted` : ""), undefined],
        ] as const).map(([k, v, f, h, tone]) => <Stat key={k} label={k} value={v} format={f} hint={h} tone={tone} aside={k === "Money received" && recShare > 0 ? <ProgressRing pct={recShare} label="Share of claimed money recovered" size={44} /> : undefined} />)}
      </Card>

      {state.recovery.length === 0 ? (
        <Card><EmptyState icon={PiggyBank} title="Nothing to recover yet" action={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden />Add a case</Button>}>Open an invoice you think was overcharged and choose “Track in Recovery”, or add a case yourself with the button above.</EmptyState></Card>
      ) : (
        <>
          <div className="max-sm:hidden"><Ledger records={open} cur={cur} total={total} /></div>

          {wide ? (
            <LayoutGroup>
              <div className="mt-4 grid grid-cols-5 items-start gap-3">
                {STAGES.map((s) => {
                  const rs = inStage(s.id);
                  return (
                    <section key={s.id} aria-labelledby={`col-${s.id}`} className="min-w-0 rounded-xl border bg-card/40 p-2">
                      <header className="px-2 pt-1.5 pb-2">
                        <h3 id={`col-${s.id}`} className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden className={`size-2 rounded-full ${s.dot}`} />{s.label}<span className="num ml-auto text-xs font-normal text-muted-foreground">{rs.length}</span></h3>
                        <p className="num mt-0.5 text-xs text-muted-foreground">{rs.length ? formatMoney(total(rs), cur) : s.hint}</p>
                      </header>
                      <ul className="space-y-2" aria-label={s.label}>
                        <AnimatePresence initial={false}>{rs.map((r) => <CaseCard key={r.id} r={r} onOpen={() => setOpenId(r.id)} />)}</AnimatePresence>
                      </ul>
                      {rs.length === 0 && <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">Nothing here</p>}
                    </section>
                  );
                })}
              </div>
            </LayoutGroup>
          ) : (
            <div className="mt-4">
              <SelectMenu label="Show stage" value={stage} onChange={(v) => setStage(v as "all" | Stage)} options={[{ value: "all", label: `All cases (${open.length})` }, ...STAGES.map((s) => ({ value: s.id, label: `${s.label} (${inStage(s.id).length})` }))]} />
              <ul className="mt-2 space-y-2" aria-label="Cases">
                <LayoutGroup><AnimatePresence initial={false}>{list.map((r) => <CaseCard key={r.id} r={r} onOpen={() => setOpenId(r.id)} showStage />)}</AnimatePresence></LayoutGroup>
              </ul>
              {list.length === 0 && <Card><EmptyState icon={PiggyBank} title="Nothing in this stage">Pick another stage above.</EmptyState></Card>}
            </div>
          )}

          {dismissed.length > 0 && (
            <Disclosure className="mt-4" title="Dismissed" subtitle="Cases that turned out to be fine" aside={<span className="num text-sm text-muted-foreground">{dismissed.length}</span>}>
              <ul className="divide-y divide-line">
                {dismissed.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <button type="button" onClick={() => setOpenId(r.id)} className="min-w-0 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.vendorName} · {formatMoney(r.amount, r.currency)}</span>
                    </button>
                    <Button size="sm" onClick={() => actions.updateRecovery(r.id, { status: "flagged" })}><RotateCcw className="size-3.5" aria-hidden />Reopen</Button>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}

      <CaseSheet id={openId} onClose={() => setOpenId(null)} />
      <Modal open={adding} onClose={() => setAdding(false)} title="Add recovery case"><AddForm onDone={() => setAdding(false)} /></Modal>
    </>
  );
}

/** Where the claimed money sits right now. Segment widths are the amounts, so it re-flows as cases move. */
function Ledger({ records, cur, total }: { records: RecoveryRecord[]; cur: string; total: (rs: RecoveryRecord[]) => ReturnType<typeof D> }) {
  const parts = STAGES.map((s) => ({ s, amount: total(records.filter((r) => r.status === s.id)) }));
  const all = parts.reduce((a, p) => a.plus(p.amount), D(0));
  const f = (n: ReturnType<typeof D>) => formatMoney(n, cur as "EUR");
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="text-base font-semibold tracking-tight">Where the money sits</h2>
        <p className="num text-sm text-muted-foreground">{f(all)} claimed across {records.length} open {records.length === 1 ? "case" : "cases"}</p>
      </div>
      <div role="img" aria-label={`Claimed money by stage: ${parts.map((p) => `${p.s.label} ${f(p.amount)}`).join(", ")}`} className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
        {parts.filter((p) => p.amount.gt(0)).map((p) => (
          <motion.div key={p.s.id} className={`h-full ${p.s.bar}`} style={{ flexBasis: 0 }} initial={{ flexGrow: 0 }} animate={{ flexGrow: p.amount.toNumber() }} transition={{ duration: 0.7, ease: EASE }} />
        ))}
      </div>
      <dl className="mt-3 hidden grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid sm:grid-cols-5">
        {parts.map((p) => (
          <div key={p.s.id} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden className={`size-2 shrink-0 rounded-full ${p.s.dot}`} />{p.s.label}</dt>
            <dd className="num mt-0.5 font-medium">{f(p.amount)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function CaseCard({ r, onOpen, showStage }: { r: RecoveryRecord; onOpen: () => void; showStage?: boolean }) {
  const next = NEXT[r.status];
  const act = nextAction(r, today());
  return (
    <motion.li layout layoutId={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="rounded-lg border bg-card p-3 shadow-xs transition-colors hover:border-primary/40">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-accent text-xs font-semibold text-accent-foreground">{initials(r.vendorName)}</span>
        <span className="text-xs text-muted-foreground">{r.vendorName}</span>
      </div>
      <button type="button" onClick={onOpen} className="mt-1.5 block w-full cursor-pointer text-left text-sm leading-snug font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{r.title}</button>
      <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2"><span className="num text-base font-semibold">{formatMoney(r.amount, r.currency)}</span><span className="text-xs text-muted-foreground">{showStage ? `${STATUS_LABEL[r.status]} · ` : ""}updated {ago(r.updatedAt)}</span></p>
      {act && <p className={`mt-1.5 text-xs leading-snug ${act.tone === "bad" ? "font-medium text-bad" : "text-muted-foreground"}`}>{act.label}</p>}
      {next && <Button size="sm" variant="secondary" className="mt-2.5 min-h-11 w-full justify-between px-3.5" onClick={() => actions.updateRecovery(r.id, { status: next.to })}>{next.label}<ArrowRight className="size-3.5" aria-hidden /></Button>}
      {!next && OPEN_CASE[r.status] && <Button size="sm" variant="secondary" className="mt-2.5 min-h-11 w-full justify-between px-3.5" onClick={onOpen}>{OPEN_CASE[r.status]}<ArrowRight className="size-3.5" aria-hidden /></Button>}
    </motion.li>
  );
}

function CaseSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const state = useAppState();
  const r = id ? state.recovery.find((x) => x.id === id) : undefined;
  return (
    <Sheet open={!!r} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
        {r && <CaseDetail key={r.id} r={r} />}
      </SheetContent>
    </Sheet>
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
      <Field label="Vendor" htmlFor="add-vendor"><SelectMenu id="add-vendor" label="Vendor" value={v.vendorId} onChange={(id) => setV({ ...v, vendorId: id })} searchable={state.vendors.length > 8} options={state.vendors.map((x) => ({ value: x.id, label: x.name }))} /></Field>
      <Field label="What happened" htmlFor="add-title"><input id="add-title" className={fieldClass} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. Charged after cancellation" /></Field>
      <Field label={`Amount (${state.settings.currency})`} htmlFor="add-amount"><input id="add-amount" inputMode="decimal" className={fieldClass} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
      <Field label="Notes" htmlFor="add-notes"><Textarea id="add-notes" rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button onClick={onDone}>Cancel</Button><Button variant="primary" onClick={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>Add record</Button></div>
    </form>
  );
}
