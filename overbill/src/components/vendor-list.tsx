"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, LayoutGrid, Rows3, Search, Store } from "lucide-react";
import { motion } from "framer-motion";
import { D, formatMoney } from "@/lib/audit/money";
import { useVendorStats } from "@/lib/data/hooks";
import { fmtDate, initials } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Card, EmptyState, fieldClass, MotionRow, PageHeader, Pill, PillTabs, Delta } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import type { VendorStats } from "@/lib/data/selectors";

const SORTS = { name: "Name", change: "Price change", recent: "Last invoice", average: "Average charge" } as const;
export const statusTone = (s: VendorStats["status"]) => (s === "Needs review" || s === "Price change" ? "warn" : s === "Stable" ? "ok" : "neutral") as "warn" | "ok" | "neutral";

const STATUSES = ["Needs review", "Price change", "Stable", "Building baseline", "Paused"] as const;

export function VendorList() {
  const { state, stats } = useVendorStats();
  const sp = useSearchParams();
  const router = useRouter();
  const q = sp.get("q") ?? "", category = sp.get("category") ?? "all", status = sp.get("status") ?? "all", sort = (sp.get("sort") ?? "name") as keyof typeof SORTS;
  const set = (k: string, v: string) => { const n = new URLSearchParams(window.location.search); if (v && !((k === "category" || k === "status") && v === "all") && !(k === "sort" && v === "name")) n.set(k, v); else n.delete(k); window.history.replaceState(null, "", `/vendors${n.toString() ? `?${n}` : ""}`); };
  const view = sp.get("view") === "table" ? "table" : "grid";
  const setView = (v: "grid" | "table") => set("view", v === "grid" ? "" : v);
  const count = (s: string) => stats.filter((x) => x.status === s).length;
  const categories = useMemo(() => [...new Set(state.vendors.map((v) => v.category))].sort(), [state.vendors]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return stats
      .filter((s) => (!needle || s.vendor.name.toLowerCase().includes(needle)) && (category === "all" || s.vendor.category === category) && (status === "all" || s.status === status))
      .sort((a, b) => sort === "change" ? (b.changePct ?? -999) - (a.changePct ?? -999) : sort === "recent" ? (b.lastInvoiceDate ?? "").localeCompare(a.lastInvoiceDate ?? "") : sort === "average" ? D(b.average).comparedTo(D(a.average)) : a.vendor.name.localeCompare(b.vendor.name));
  }, [stats, q, category, status, sort]);

  return (
    <>
      <PageHeader title="Vendors" description="Each supplier and what they usually charge. Open one to see price history and anything flagged." />
      <Card className="max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none max-sm:ring-0">
        <div className="border-b px-4 pt-4 max-sm:border-0 max-sm:px-0 max-sm:pt-0"><PillTabs id="ven" label="Filter by status" value={status} onChange={(v) => set("status", v)} items={[{ value: "all", label: "All vendors", count: stats.length }, ...STATUSES.map((s) => ({ value: s, label: s, count: count(s) }))]} /></div>
        <div className="grid grid-cols-2 gap-3 border-b border-line bg-canvas/50 p-4 max-sm:border-0 max-sm:bg-transparent max-sm:px-0 max-sm:pt-1 sm:flex sm:flex-wrap">
          <div className="relative col-span-2 min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-subtle" aria-hidden />
            <input aria-label="Search vendors" enterKeyHint="search" placeholder="Search vendors" value={q} onChange={(e) => set("q", e.target.value)} className={`${fieldClass} pl-9`} />
          </div>
          <select aria-label="Filter by category" value={category} onChange={(e) => set("category", e.target.value)} className={cn(fieldClass, "hidden w-auto sm:block")}><option value="all">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <select aria-label="Sort vendors" value={sort} onChange={(e) => set("sort", e.target.value)} className={cn(fieldClass, "hidden w-auto sm:block")}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v}</option>)}</select>
          <div role="group" aria-label="View" className="hidden rounded-lg border bg-card p-0.5 sm:flex">{([["grid", LayoutGrid, "Cards"], ["table", Rows3, "Table"]] as const).map(([v, Icon, label]) => <button key={v} type="button" aria-pressed={view === v} aria-label={`${label} view`} onClick={() => setView(v)} className={cn("grid size-8 cursor-pointer place-items-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}><Icon className="size-4" aria-hidden /></button>)}</div>
        </div>
        {state.vendors.length === 0 ? (
          <EmptyState icon={Store} title="No vendors yet">Vendors are added automatically when you check an invoice. Upload a bill to begin.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title="No vendor by that name">Try fewer letters, or clear the filters.</EmptyState>
        ) : view === "grid" ? (
          <ul aria-label="Vendors" className="grid gap-4 p-4 max-sm:gap-5 max-sm:px-0 max-sm:pt-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map((s, i) => <VendorCard key={s.vendor.id} s={s} i={i} fallback={state.settings.currency} />)}</ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">Vendors</caption>
              <thead className="border-b border-line-strong bg-canvas/60 text-left text-xs tracking-wider text-muted-foreground "><tr>
                {["Vendor", "Category", "Invoices", "Average", "Latest", "Change", "Last invoice", "Status", "Trend"].map((h, i) => <th key={h} scope="col" className={`px-3 py-2.5 font-medium first:pl-5 last:pr-5 ${[2, 3, 4, 5].includes(i) ? "text-right" : ""}`}>{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((s, i) => {
                  const cur = s.latest?.currency ?? state.settings.currency;
                  return (
                    <MotionRow key={s.vendor.id} i={i} onClick={() => router.push(`/vendors/${s.vendor.id}`)} className="cursor-pointer transition-colors duration-150 hover:bg-primary-soft/50">
                      <td className="py-3 pr-3 pl-5 font-semibold"><Link href={`/vendors/${s.vendor.id}`} className="flex items-center gap-2.5 hover:underline" onClick={(e) => e.stopPropagation()}><span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-xs font-semibold text-accent-foreground">{initials(s.vendor.name)}</span>{s.vendor.name}</Link></td>
                      <td className="px-3 py-3 text-muted-foreground">{s.vendor.category}</td>
                      <td className="num px-3 py-3 text-right">{s.invoiceCount}</td>
                      <td className="num px-3 py-3 text-right">{s.average ? formatMoney(s.average, cur) : "—"}</td>
                      <td className="num px-3 py-3 text-right">{s.latest ? formatMoney(s.latest.total, cur) : "—"}</td>
                      <td className="num px-3 py-3 text-right">{s.changePct === null ? "—" : `${s.changePct > 0 ? "+" : ""}${s.changePct}%`}</td>
                      <td className="px-3 py-3 text-muted-foreground">{s.lastInvoiceDate ? fmtDate(s.lastInvoiceDate) : "—"}</td>
                      <td className="px-3 py-3"><Pill tone={statusTone(s.status)}>{s.status}</Pill></td>
                      <td className="py-3 pr-5 pl-3"><span className="flex items-center gap-2"><span className="hidden sm:block"><Sparkline values={s.unique.map((i) => Number(i.total))} tone={s.trend === "up" ? "warn" : "neutral"} /></span>{s.trend === "up" ? <ArrowUpRight className="size-4 text-warn" aria-label="Trending up" /> : s.trend === "down" ? <ArrowDownRight className="size-4 text-ok" aria-label="Trending down" /> : <ArrowRight className="size-4 text-subtle" aria-label="Flat" />}</span></td>
                    </MotionRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}


function VendorCard({ s, i, fallback }: { s: VendorStats; i: number; fallback: string }) {
  const cur = (s.latest?.currency ?? fallback) as "EUR" | "USD" | "GBP";
  const limit = s.vendor.billing === "variable" ? 15 : 5;
  return (
    <motion.li initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1], delay: Math.min(i, 8) * 0.05 }} whileHover={{ y: -3 }} className="group relative">
      <Link href={`/vendors/${s.vendor.id}`} className="block h-full rounded-xl border bg-card p-4 shadow-xs outline-none transition-[border-color,box-shadow] duration-200 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-sm font-semibold text-accent-foreground">{initials(s.vendor.name)}</span>
            <div className="min-w-0"><p className="line-clamp-2 text-sm leading-tight font-semibold">{s.vendor.name}</p><p className="truncate text-xs text-muted-foreground">{s.vendor.category}</p></div>
          </div>
          <Pill tone={statusTone(s.status)}>{s.status}</Pill>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3 sm:mt-4">
          <div><p className="eyebrow hidden !text-xs sm:block">Latest charge</p><p className="num text-xl font-semibold sm:mt-1 sm:text-2xl">{s.latest ? formatMoney(s.latest.total, cur) : "—"}</p></div>
          <span className="hidden sm:block"><Sparkline values={s.unique.map((x) => Number(x.total))} tone={s.trend === "up" ? "warn" : "neutral"} /></span>
        </div>
        <dl className="mt-4 hidden grid-cols-3 gap-2 border-t pt-3 text-xs sm:grid">
          <div><dt className="text-muted-foreground">Change</dt><dd className="mt-1"><Delta pct={s.changePct} limit={limit} /></dd></div>
          <div><dt className="text-muted-foreground">Average</dt><dd className="num mt-1 font-medium">{s.average ? formatMoney(s.average, cur) : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Invoices</dt><dd className="num mt-1 font-medium">{s.invoiceCount}</dd></div>
        </dl>
        <p className="mt-2 flex items-center justify-between text-xs sm:mt-3 text-muted-foreground"><span>{s.openFindings.length > 0 ? `${s.openFindings.length} open finding${s.openFindings.length === 1 ? "" : "s"}` : s.lastInvoiceDate ? `Last invoice ${fmtDate(s.lastInvoiceDate)}` : "No invoices yet"}</span><ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden /></p>
      </Link>
    </motion.li>
  );
}
