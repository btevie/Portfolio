import { Skeleton } from "@/components/ui/skeleton";

const Header = () => (
  <div className="mb-6 space-y-3 border-b pb-5">
    <Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-80 max-w-full" />
  </div>
);

/** Fallback for list pages (invoices, vendors): header, KPI strip, table rows. */
export function ListSkeleton({ kpis = true }: { kpis?: boolean }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <Header />
      {kpis && <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="space-y-2 bg-card p-5"><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-24" /></div>)}</div>}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="space-y-2 border-b p-4"><Skeleton className="h-9 w-full" /></div>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-5 py-4 last:border-0"><div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28" /></div><Skeleton className="h-4 w-16" /><Skeleton className="h-6 w-24" /></div>
        ))}
      </div>
    </div>
  );
}

/** Fallback for a detail page. */
export function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-3 h-4 w-20" /><Header />
      <Skeleton className="mb-6 h-20 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
