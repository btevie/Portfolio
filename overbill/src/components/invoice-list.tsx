"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { FileText, Search, Upload } from "lucide-react";
import { formatMoney } from "@/lib/audit/money";
import { parseISO } from "@/lib/audit/normalize";
import { useAudited } from "@/lib/data/hooks";
import { effectiveClassification } from "@/lib/data/selectors";
import { fmtDate } from "@/lib/format";
import { Card, ClassBadge, EmptyState, fieldClass, LinkButton, PageHeader, Pill } from "@/components/ui";

const SORTS = { date_desc: "Newest first", date_asc: "Oldest first", amount_desc: "Amount: high to low", vendor: "Vendor A–Z" } as const;

export function InvoiceList() {
  const { state, audits } = useAudited();
  const sp = useSearchParams();
  const q = sp.get("q") ?? "", status = sp.get("status") ?? "all", sort = (sp.get("sort") ?? "date_desc") as keyof typeof SORTS;
  // Build from the live URL (not the render-time snapshot) so rapid successive changes never resurrect a cleared filter.
  const set = (k: string, v: string) => { const n = new URLSearchParams(window.location.search); if (v && !(k === "status" && v === "all") && !(k === "sort" && v === "date_desc")) n.set(k, v); else n.delete(k); window.history.replaceState(null, "", `/invoices${n.toString() ? `?${n}` : ""}`); };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.invoices
      .map((i) => ({ i, c: effectiveClassification(state, audits[i.id]) }))
      .filter(({ i, c }) => (!needle || `${i.vendorName} ${i.number}`.toLowerCase().includes(needle)) && (status === "all" || (status === "attention" ? c !== "CLEAR" : status === "clear" ? c === "CLEAR" : c === status.toUpperCase())))
      .sort((a, b) => sort === "date_asc" ? (parseISO(a.i.date) ?? 0) - (parseISO(b.i.date) ?? 0) : sort === "amount_desc" ? Number(b.i.total) - Number(a.i.total) : sort === "vendor" ? a.i.vendorName.localeCompare(b.i.vendorName) : (parseISO(b.i.date) ?? 0) - (parseISO(a.i.date) ?? 0) || b.i.createdAt - a.i.createdAt);
  }, [state, audits, q, status, sort]);

  return (
    <>
      <PageHeader title="Invoices" description="Every invoice you've checked, with its audit result." actions={<LinkButton href="/invoices/new" variant="primary"><Upload className="size-4" aria-hidden />Upload invoice</LinkButton>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-subtle" aria-hidden />
            <input aria-label="Search invoices" placeholder="Search vendor or invoice number" value={q} onChange={(e) => set("q", e.target.value)} className={`${fieldClass} pl-9`} />
          </div>
          <select aria-label="Filter by status" value={status} onChange={(e) => set("status", e.target.value)} className={`${fieldClass} w-auto`}>
            <option value="all">All statuses</option><option value="attention">Needs attention</option><option value="likely_error">Likely error</option><option value="review_needed">Review needed</option><option value="clear">Clear</option>
          </select>
          <select aria-label="Sort invoices" value={sort} onChange={(e) => set("sort", e.target.value)} className={`${fieldClass} w-auto`}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {state.invoices.length === 0 ? (
          <EmptyState icon={FileText} title="No invoices yet" action={<LinkButton href="/invoices/new" variant="primary">Upload an invoice</LinkButton>}>Your invoice history starts here. Upload your first bill to establish a baseline and catch unexpected charges.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title="No invoices match">Try a different search or clear the filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Invoices</caption>
              <thead className="border-b border-line text-left text-xs text-muted"><tr><th scope="col" className="px-5 py-2.5 font-medium">Vendor</th><th scope="col" className="px-3 py-2.5 font-medium">Invoice</th><th scope="col" className="px-3 py-2.5 font-medium">Date</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Total</th><th scope="col" className="px-5 py-2.5 font-medium">Result</th></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ i, c }) => (
                  <tr key={i.id} className="hover:bg-canvas">
                    <td className="px-5 py-3 font-medium"><Link href={`/invoices/${i.id}`} className="hover:underline">{i.vendorName}</Link>{i.source === "upload" && <Pill tone="primary" className="ml-2">Uploaded</Pill>}</td>
                    <td className="px-3 py-3 text-muted">{i.number}</td>
                    <td className="px-3 py-3 text-muted">{fmtDate(i.date)}</td>
                    <td className="num px-3 py-3 text-right">{formatMoney(i.total, i.currency)}</td>
                    <td className="px-5 py-3"><ClassBadge value={c} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
