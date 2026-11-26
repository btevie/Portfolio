"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Search, Store } from "lucide-react";
import { D, formatMoney } from "@/lib/audit/money";
import { useVendorStats } from "@/lib/data/hooks";
import { fmtDate } from "@/lib/format";
import { Card, EmptyState, fieldClass, PageHeader, Pill } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import type { VendorStats } from "@/lib/data/selectors";

const SORTS = { name: "Name", change: "Price change", recent: "Last invoice", average: "Average charge" } as const;
export const statusTone = (s: VendorStats["status"]) => (s === "Needs review" ? "bad" : s === "Price change" ? "warn" : s === "Stable" ? "ok" : "neutral") as "bad" | "warn" | "ok" | "neutral";

export function VendorList() {
  const { state, stats } = useVendorStats();
  const sp = useSearchParams();
  const q = sp.get("q") ?? "", category = sp.get("category") ?? "all", status = sp.get("status") ?? "all", sort = (sp.get("sort") ?? "name") as keyof typeof SORTS;
  const set = (k: string, v: string) => { const n = new URLSearchParams(window.location.search); if (v && !((k === "category" || k === "status") && v === "all") && !(k === "sort" && v === "name")) n.set(k, v); else n.delete(k); window.history.replaceState(null, "", `/vendors${n.toString() ? `?${n}` : ""}`); };
  const categories = useMemo(() => [...new Set(state.vendors.map((v) => v.category))].sort(), [state.vendors]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return stats
      .filter((s) => (!needle || s.vendor.name.toLowerCase().includes(needle)) && (category === "all" || s.vendor.category === category) && (status === "all" || s.status === status))
      .sort((a, b) => sort === "change" ? (b.changePct ?? -999) - (a.changePct ?? -999) : sort === "recent" ? (b.lastInvoiceDate ?? "").localeCompare(a.lastInvoiceDate ?? "") : sort === "average" ? D(b.average).comparedTo(D(a.average)) : a.vendor.name.localeCompare(b.vendor.name));
  }, [stats, q, category, status, sort]);

  return (
    <>
      <PageHeader title="Vendors" description="Watch how each vendor's charges move over time. Click a vendor for history, baselines and monitoring settings." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-subtle" aria-hidden />
            <input aria-label="Search vendors" placeholder="Search vendors" value={q} onChange={(e) => set("q", e.target.value)} className={`${fieldClass} pl-9`} />
          </div>
          <select aria-label="Filter by category" value={category} onChange={(e) => set("category", e.target.value)} className={`${fieldClass} w-auto`}><option value="all">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <select aria-label="Filter by status" value={status} onChange={(e) => set("status", e.target.value)} className={`${fieldClass} w-auto`}><option value="all">All statuses</option>{["Needs review", "Price change", "Stable", "Building baseline", "Paused"].map((c) => <option key={c}>{c}</option>)}</select>
          <select aria-label="Sort vendors" value={sort} onChange={(e) => set("sort", e.target.value)} className={`${fieldClass} w-auto`}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v}</option>)}</select>
        </div>
        {state.vendors.length === 0 ? (
          <EmptyState icon={Store} title="No vendors yet">Your invoice history starts here. Upload your first bill to establish a baseline and catch unexpected charges.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title="No vendors match">Try a different search or clear the filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">Vendors</caption>
              <thead className="border-b border-line text-left text-xs text-muted"><tr>
                {["Vendor", "Category", "Invoices", "Average", "Latest", "Change", "Last invoice", "Status", "Trend"].map((h, i) => <th key={h} scope="col" className={`px-3 py-2.5 font-medium first:pl-5 last:pr-5 ${[2, 3, 4, 5].includes(i) ? "text-right" : ""}`}>{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => {
                  const cur = s.latest?.currency ?? state.settings.currency;
                  return (
                    <tr key={s.vendor.id} className="hover:bg-canvas">
                      <td className="py-3 pr-3 pl-5 font-medium"><Link href={`/vendors/${s.vendor.id}`} className="hover:underline">{s.vendor.name}</Link></td>
                      <td className="px-3 py-3 text-muted">{s.vendor.category}</td>
                      <td className="num px-3 py-3 text-right">{s.invoiceCount}</td>
                      <td className="num px-3 py-3 text-right">{s.average ? formatMoney(s.average, cur) : "—"}</td>
                      <td className="num px-3 py-3 text-right">{s.latest ? formatMoney(s.latest.total, cur) : "—"}</td>
                      <td className="num px-3 py-3 text-right">{s.changePct === null ? "—" : `${s.changePct > 0 ? "+" : ""}${s.changePct}%`}</td>
                      <td className="px-3 py-3 text-muted">{s.lastInvoiceDate ? fmtDate(s.lastInvoiceDate) : "—"}</td>
                      <td className="px-3 py-3"><Pill tone={statusTone(s.status)}>{s.status}</Pill></td>
                      <td className="py-3 pr-5 pl-3"><span className="flex items-center gap-2"><Sparkline values={s.unique.map((i) => Number(i.total))} tone={s.trend === "up" ? "bad" : "neutral"} />{s.trend === "up" ? <ArrowUpRight className="size-4 text-bad" aria-label="Trending up" /> : s.trend === "down" ? <ArrowDownRight className="size-4 text-ok" aria-label="Trending down" /> : <ArrowRight className="size-4 text-subtle" aria-label="Flat" />}</span></td>
                    </tr>
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
