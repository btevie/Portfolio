"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, ArrowUpRight, FileCheck2, Inbox, TrendingUp, Upload } from "lucide-react";
import { D, formatMoney } from "@/lib/audit/money";
import { useVendorStats } from "@/lib/data/hooks";
import { dashboardMetrics, effectiveClassification, isOpen } from "@/lib/data/selectors";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import { BarChart } from "@/components/charts";
import { Card, ClassBadge, EmptyState, LinkButton, PageHeader, Pill, SectionHeader, SeverityPill } from "@/components/ui";
import { cn } from "@/lib/cn";

function Kpi({ label, value, hint, tone, href }: { label: string; value: string; hint: string; tone?: "warn" | "ok"; href?: string }) {
  const body = (
    <Card className={cn("h-full p-5 transition-colors duration-150", href && "hover:border-line-strong")}>
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={cn("num mt-2 text-[28px] leading-none font-semibold tracking-tight", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Dashboard() {
  const { state, audits, stats } = useVendorStats();
  const m = useMemo(() => dashboardMetrics(state, audits), [state, audits]);
  const cur = m.currency;

  const findings = useMemo(() => {
    const byId = new Map(state.invoices.map((i) => [i.id, i]));
    const rank = { LIKELY_ERROR: 0, REVIEW_NEEDED: 1 } as const;
    return Object.values(audits).flatMap((a) => a.findings).filter((f) => isOpen(state, f))
      .sort((a, b) => rank[a.classification] - rank[b.classification] || D(b.amountAtRisk).comparedTo(D(a.amountAtRisk)))
      .slice(0, 5).map((f) => ({ f, inv: byId.get(f.invoiceId)! }));
  }, [state, audits]);

  const limit = (s: (typeof stats)[number]) => (s.vendor.billing === "variable" ? 15 : 5);
  const monitored = stats.filter((s) => s.changePct !== null && s.changePct >= 5 && s.vendor.monitoring.enabled).sort((a, b) => b.changePct! - a.changePct!);
  const alerts = monitored.filter((s) => s.changePct! >= limit(s));
  const normal = monitored.filter((s) => s.changePct! < limit(s));

  const activity = useMemo(() => {
    const items = [
      ...[...state.invoices].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((i) => {
        const c = effectiveClassification(state, audits[i.id]);
        return { key: i.id, date: new Date(i.source === "upload" ? i.createdAt : Date.parse(i.date)).toISOString().slice(0, 10), href: `/invoices/${i.id}`, text: `${i.vendorName} · ${i.number}`, sub: c === "CLEAR" ? "Checked — no issues found" : `Checked — ${audits[i.id].findings.length} finding${audits[i.id].findings.length === 1 ? "" : "s"} to look at`, c };
      }),
      ...state.recovery.map((r) => ({ key: r.id, date: r.updatedAt, href: "/recovery", text: r.title, sub: `Recovery → ${STATUS_LABEL[r.status]} · ${formatMoney(r.amount, r.currency)}`, c: null })),
    ];
    return items.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);
  }, [state, audits]);

  if (state.invoices.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card><EmptyState icon={Inbox} title="Your invoice history starts here" action={<LinkButton href="/invoices/new" variant="primary"><Upload className="size-4" />Upload your first invoice</LinkButton>}>
          Upload your first bill to establish a baseline and catch unexpected charges.
        </EmptyState></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Know what changed, what looks wrong, and what you could be overpaying — before you pay."
        actions={<LinkButton href="/invoices/new" variant="primary"><Upload className="size-4" aria-hidden />Upload invoice</LinkButton>}
      />

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Potential overcharges" value={formatMoney(m.potentialOvercharges, cur)} tone={m.potentialOvercharges.gt(0) ? "warn" : undefined} hint={m.excludedCurrencies ? `Anomalies, not confirmed errors · ${m.excludedCurrencies} in other currencies excluded` : "Anomalies detected, not confirmed errors"} href="/invoices?status=attention" />
        <Kpi label="Bills needing review" value={String(m.needsReview.length)} hint={m.needsReview.length ? "Open them before you pay" : "Nothing waiting on you"} href="/invoices?status=attention" />
        <Kpi label="Money recovered" value={formatMoney(m.recovered, cur)} tone="ok" hint="Confirmed refunds and credits" href="/recovery" />
        <Kpi label="Invoices checked" value={String(m.invoicesChecked)} hint={`Across ${state.vendors.length} vendors`} href="/invoices" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionHeader title="Recent discrepancies" description="Highest priority first. Each is an anomaly until you confirm it." action={<Link href="/invoices?status=attention" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">View all <ArrowRight className="size-3.5" aria-hidden /></Link>} />
          {findings.length === 0 ? (
            <EmptyState icon={FileCheck2} title="Everything looks consistent">Everything looks consistent. We&apos;ll keep watching for changes.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {findings.map(({ f, inv }) => (
                <li key={f.id}>
                  <Link href={`/invoices/${inv.id}?finding=${encodeURIComponent(f.id)}`} className="flex items-start gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2"><ClassBadge value={f.classification} size="sm" /><SeverityPill value={f.severity} /></div>
                      <p className="text-sm font-medium text-ink">{f.title}</p>
                      <p className="mt-0.5 text-xs text-muted">{inv.vendorName} · {inv.number} · {fmtDate(inv.date)}</p>
                    </div>
                    {D(f.amountAtRisk).gt(0) && <div className="text-right"><p className="num text-sm font-semibold">{formatMoney(f.amountAtRisk, inv.currency)}</p><p className="text-[11px] text-muted">at stake</p></div>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader title="Vendor price changes" description="Latest charge vs. your usual." />
          {monitored.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No price changes">No monitored vendor has moved beyond its normal range.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {[...alerts, ...normal].map((s) => (
                <li key={s.vendor.id}>
                  <Link href={`/vendors/${s.vendor.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-canvas">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{s.vendor.name}</p><p className="num text-xs text-muted">{formatMoney(s.latest!.total, s.latest!.currency)} latest · avg {s.average ? formatMoney(s.average, s.latest!.currency) : "—"}{s.changePct! < limit(s) ? " · within normal range for usage-based billing" : ""}</p></div>
                    <Pill tone={s.changePct! >= limit(s) ? "warn" : "neutral"}><ArrowUpRight className="size-3" aria-hidden />+{s.changePct}%</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Monthly spending" description={`Invoiced totals in ${cur}, re-sent copies counted once`} />
          <div className="px-5 pb-4"><BarChart data={m.monthly} currency={cur} ariaLabel={`Monthly spending, last 6 months: ${m.monthly.map((x) => `${x.label} ${Math.round(x.total)}`).join(", ")}`} /></div>
        </Card>
        <Card>
          <SectionHeader title="Recent activity" />
          <ul className="divide-y divide-line">
            {activity.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-canvas">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{a.text}</p><p className="truncate text-xs text-muted">{a.sub}</p></div>
                  <div className="flex shrink-0 items-center gap-3">{a.c && <ClassBadge value={a.c} size="sm" />}<time className="text-xs text-subtle">{fmtDate(a.date)}</time></div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
