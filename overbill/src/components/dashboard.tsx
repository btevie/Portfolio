"use client";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { GET_STARTED_EVENT, getStartedVisible, hideGetStarted } from "@/lib/get-started";
import { ArrowRight, Check, Download, CheckCircle2, Circle, Inbox, Upload, X } from "lucide-react";
import { initials } from "@/lib/format";
import { D, formatMoney } from "@/lib/audit/money";
import { daysBetween, parseISO } from "@/lib/audit/normalize";
import { useVendorStats } from "@/lib/data/hooks";
import { actionQueue, dashboardMetrics, paymentStatusAt, pendingCreditNote, stakeByVendor, today } from "@/lib/data/selectors";
import { useBackupAge } from "@/lib/backup";
import { ChartCard } from "@/components/charts/kpi-charts";
import { SpendCard } from "@/components/spend-card";
import { Card, Disclosure, EmptyState, LinkButton, PageHeader } from "@/components/ui";

function dueLabel(due: string, paid: boolean) {
  if (paid) return "Paid";
  const d = daysBetween(parseISO(today()) ?? 0, parseISO(due) ?? 0);
  return d < 0 ? `Overdue by ${-d} day${d === -1 ? "" : "s"}` : d === 0 ? "Due today" : `Due in ${d} day${d === 1 ? "" : "s"}`;
}

function GetStarted({ steps }: { steps: { label: string; done: boolean; href: string }[] }) {
  const visible = useSyncExternalStore(
    (cb) => { window.addEventListener(GET_STARTED_EVENT, cb); return () => window.removeEventListener(GET_STARTED_EVENT, cb); },
    getStartedVisible,
    () => false,
  );
  const done = steps.filter((s) => s.done).length;
  if (!visible || done === steps.length) return null;
  return (
    <section aria-label="Get started" className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border bg-card px-4 py-3">
      <p className="text-sm font-semibold">Get started <span className="num font-normal text-muted-foreground">{done} of {steps.length}</span></p>
      <ul className="order-last flex w-full flex-col sm:order-none sm:w-auto sm:flex-1 sm:flex-row sm:flex-wrap sm:gap-x-5">
        {steps.map((s) => (
          <li key={s.label}><Link href={s.href} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground sm:min-h-9">
            {s.done ? <Check className="size-4 text-ok" aria-hidden /> : <Circle className="size-4" aria-hidden />}<span className={s.done ? "line-through" : ""}>{s.label}</span>
          </Link></li>
        ))}
      </ul>
      <button type="button" aria-label="Hide get started" onClick={hideGetStarted} className="ml-auto grid size-11 sm:size-9 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="size-4" aria-hidden /></button>
    </section>
  );
}

export function Dashboard() {
  const { state, audits, stats } = useVendorStats();
  const m = useMemo(() => dashboardMetrics(state, audits, 6), [state, audits]);
  const cur = m.currency;
  const backupDays = useBackupAge();
  const hasOwnData = state.invoices.some((i) => i.source !== "demo"); // sample data needs no backup
  const stakeText = m.atStake.map((t) => formatMoney(t.amount, t.currency)).join(" · "); // per currency, never summed
  const whole = (v: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v);

  const queue = useMemo(() => actionQueue(state, audits), [state, audits]);
  const lead = queue[0];
  const next = queue.slice(1, 4);
  const vendors = useMemo(() => stakeByVendor(queue, cur), [queue, cur]);
  const vendorTotal = vendors.reduce((a, v) => a.plus(v.amount), D(0));

  const limit = (s: (typeof stats)[number]) => (s.vendor.billing === "variable" ? 15 : 5);
  const moved = stats.filter((s) => s.changePct !== null && s.changePct >= 5 && s.vendor.monitoring.enabled).sort((a, b) => b.changePct! - a.changePct!);

  if (!state.invoices.some((i) => !i.isCredit)) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card><EmptyState icon={Inbox} title="Your invoice history starts here" action={<div className="flex flex-wrap justify-center gap-2"><LinkButton href="/invoices/new" variant="primary"><Upload className="size-4" />Upload your first invoice</LinkButton><LinkButton href="/demo">Try sample data</LinkButton></div>}>
          Upload your first bill to establish a baseline and catch unexpected charges.
        </EmptyState></Card>
      </>
    );
  }

  const rs = m.recoveryStats;

  return (
    <div className="grid w-full min-w-0 gap-4 sm:gap-4">
      <div className="mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground" data-testid="plain-summary">
          {m.needsReview.length > 0
            ? <>{m.needsReview.length} invoice{m.needsReview.length === 1 ? " needs" : "s need"} a look{m.atStake.length > 0 && <>. About <strong className="num font-semibold text-ink">{stakeText}</strong> may be overcharged{m.atStake.length > 1 && <> (separate totals per currency)</>}</>}.</>
            : <>Everything looks consistent with the checks we ran. That is not a guarantee, so keep reading invoices before you pay.</>}
        </p>
      </div>

      {hasOwnData && backupDays !== undefined && (backupDays === null || backupDays >= 30) && (
        <Link href="/data" className="flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-2.5 text-sm transition-transform active:scale-[0.98]">
          <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">Your invoices live only in this browser. <strong className="font-semibold">{backupDays === null ? "Download a backup" : `Last backup ${backupDays} days ago. Download a new one`}</strong> so clearing site data can&apos;t erase them.</span>
        </Link>
      )}

      <GetStarted steps={[
        { label: "Check one of your own invoices", done: state.invoices.some((i) => i.source === "upload" && !i.isCredit), href: "/invoices/new" },
        { label: "Review a finding", done: Object.keys(state.decisions).length > 0, href: "/invoices?status=attention" },
        { label: "Draft a dispute note", done: state.recovery.some((r) => r.notes?.includes("Note drafted in Overbill")), href: "/invoices?status=attention" },
      ]} />

      {/* 1 · Needs attention */}
      <section aria-labelledby="attn-h" className="grid gap-3">
        <h2 id="attn-h" className="text-sm font-semibold tracking-[-0.01em]">Start here: what to review next</h2>
        {!lead ? (
          <div className="flex items-center gap-2 rounded-lg bg-ok-bg px-3 py-2 text-ok ring-1 ring-ok-line"><CheckCircle2 className="size-4 shrink-0" aria-hidden /><p className="text-sm font-medium">Nothing flagged right now. Our checks can miss things, so keep an eye on new invoices.</p></div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
            <article className={`flex flex-col gap-3 self-start rounded-2xl p-4 ring-1 sm:gap-4 sm:p-6 ${lead.finding.classification === "LIKELY_ERROR" ? "border-bad-line bg-bad-bg text-bad ring-bad-line" : "border-line bg-card ring-line"}`}>
              <div>
                <h3 className="text-base leading-snug font-semibold tracking-tight sm:text-xl">{lead.invoice.vendorName}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{lead.finding.title}</p>
              </div>
              <div className="flex items-end justify-between gap-3">
                <div><p className={`text-xs font-medium ${lead.finding.classification === "LIKELY_ERROR" ? "text-bad" : "text-warn"}`}>Possible overcharge (not confirmed)</p><p className={`num mt-0.5 text-xl leading-none font-semibold tracking-tight sm:text-3xl ${lead.finding.classification === "LIKELY_ERROR" ? "text-bad" : "text-warn"}`}>{D(lead.finding.amountAtRisk).gt(0) ? formatMoney(lead.finding.amountAtRisk, lead.invoice.currency) : "—"}</p></div>
                <p className={`text-sm font-medium ${paymentStatusAt(lead.invoice) === "overdue" ? "text-bad" : "text-muted-foreground"}`}>{dueLabel(lead.invoice.dueDate, paymentStatusAt(lead.invoice) === "paid")}</p>
              </div>
              <LinkButton href={`/invoices/${lead.invoice.id}?finding=${encodeURIComponent(lead.finding.id)}`} variant="primary" className="w-full sm:w-fit">Review invoice<ArrowRight className="size-4" aria-hidden /></LinkButton>
            </article>

                        <div className="rounded-2xl bg-card p-3 ring-1 ring-line sm:p-4">
              <div className="flex items-center justify-between rounded-xl bg-muted/70 px-3 py-2 text-xs text-muted-foreground"><span>Up next</span><Link href="/invoices?status=attention" className="font-medium text-primary">See all {m.needsReview.length}</Link></div>
              {next.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">That&apos;s the only open finding.</p> : (
                <ol className="mt-1">
                  {next.map(({ finding: f, invoice: inv }) => (
                    <li key={f.id}>
                      <Link href={`/invoices/${inv.id}?finding=${encodeURIComponent(f.id)}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-2 py-3 transition-colors active:bg-muted/60 sm:hover:bg-muted/50">
                        <span aria-hidden className="grid size-10 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{initials(inv.vendorName)}</span>
                        <span className="min-w-0"><span className="block truncate text-sm font-medium">{inv.vendorName}</span><span className="block truncate text-xs text-muted-foreground">{f.title}</span></span>
                        <span className="num text-sm font-semibold">{D(f.amountAtRisk).gt(0) ? formatMoney(f.amountAtRisk, inv.currency) : "—"}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 2 · Figure cards: one bold, the rest soft */}
      {/* 2 · Key figures: one ruled strip, not a card grid */}
      <section aria-label="Key figures" className="grid grid-cols-2 divide-x divide-line overflow-hidden rounded-2xl bg-card ring-1 ring-line sm:grid-cols-3">
        {([
          ["Possible overcharges", m.atStake[0] ? formatMoney(m.atStake[0].amount, m.atStake[0].currency) : formatMoney(0, cur), "/invoices?status=attention", "text-warn", m.atStake.length > 1 ? `Also ${m.atStake.slice(1).map((t) => formatMoney(t.amount, t.currency)).join(" · ")}` : "Possible, not confirmed. You decide on each invoice."],
          ["Money received back", formatMoney(m.recovered, cur), "/recovery", "text-ok", pendingCreditNote(rs, (d) => formatMoney(d, cur)) ?? "Only what you marked as received"],
          ["Past due", String(state.invoices.filter((i) => !i.isCredit && paymentStatusAt(i) === "overdue").length), "/invoices", "", null],
        ] as const).map(([label, value, href, tone, note]) => (
          <Link key={label} href={href} className={`${label === "Past due" ? "max-sm:hidden " : ""}block px-4 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`num mt-0.5 text-lg leading-tight font-semibold tracking-tight ${tone}`}>{value}</p>
            {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
          </Link>
        ))}
      </section>

      <SpendCard months={m.monthly} format={whole} />

      {/* 3 · Analytics (tucked away by default to keep the first screen simple) */}
      <Disclosure title="Charts & trends" subtitle="Price changes by vendor">
      <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
        <ChartCard title="Vendor price changes" subtitle="Latest vs usual charge">
          {moved.length === 0 ? <p className="text-sm text-muted-foreground">No monitored vendor has moved beyond its normal range.</p> : (
            <>
              <div className="overflow-x-auto"><table className="num w-full text-sm">
                <caption className="sr-only">Latest and usual charge per vendor</caption>
                <thead><tr className="eyebrow text-left"><th scope="col" className="pb-1 font-semibold">Vendor</th><th scope="col" className="pb-1 pl-3 text-right font-semibold">Latest</th><th scope="col" className="pb-1 pl-3 text-right font-semibold">Usual</th><th scope="col" className="pb-1 pl-3 text-right font-semibold">Change</th><th scope="col" className="hidden pb-1 pl-3 text-right font-semibold sm:table-cell">Alert at</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {moved.map((s) => (
                    <tr key={s.vendor.id}>
                      <th scope="row" className="py-1.5 text-left font-medium"><Link href={`/vendors/${s.vendor.id}`} className="hover:underline">{s.vendor.name}</Link></th>
                      <td className="py-1.5 pl-2 text-right">{formatMoney(s.latest!.total, s.latest!.currency)}</td>
                      <td className="py-1.5 pl-2 text-right text-muted-foreground">{s.average ? formatMoney(s.average, s.latest!.currency) : "—"}</td>
                      <td className={`pl-3 py-1.5 text-right font-semibold ${s.changePct! >= limit(s) ? "text-warn" : "text-muted-foreground"}`}>+{s.changePct}%{s.changePct! >= limit(s) ? <span className="sr-only"> (over threshold)</span> : null}</td>
                      <td className="hidden pl-3 py-1.5 text-right text-muted-foreground sm:table-cell">{limit(s)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}
        </ChartCard>

        <ChartCard title="Where the money at stake sits" subtitle="Open findings by vendor">
          {vendors.length === 0 ? <p className="text-sm text-muted-foreground">No open anomalies with money at stake.</p> : (
            <ol className="-mx-2 grid">
              {vendors.slice(0, 4).map((v, n) => {
                const pct = vendorTotal.gt(0) ? v.amount.div(vendorTotal).times(100).toNumber() : 0;
                return (
                  <li key={v.vendorId}>
                    <Link href={`/invoices?q=${encodeURIComponent(v.vendorName)}&status=attention`} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-canvas">
                      <span className="num text-sm font-semibold text-subtle">{n + 1}</span>
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{v.vendorName}</span><span className="block text-xs text-muted-foreground">{v.findings} open anomal{v.findings === 1 ? "y" : "ies"}</span></span>
                      <span className="num text-right text-sm font-semibold">{formatMoney(v.amount, cur)}<span className="ml-1.5 text-xs font-normal text-muted-foreground">{Math.round(pct)}%</span></span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </ChartCard>

      </div>
      </Disclosure>
    </div>
  );
}
