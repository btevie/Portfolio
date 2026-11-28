"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { GitMerge } from "lucide-react";
import { useAudited } from "@/lib/data/hooks";
import { actions } from "@/lib/data/store";
import { duplicateVendorPairs, vendorScorecard } from "@/lib/insights";
import type { Vendor } from "@/lib/types";
import { Button } from "@/components/ui";

/** What the findings on this vendor add up to, in numbers. Never a verdict on the vendor. */
export function VendorScorecard({ vendor }: { vendor: Vendor }) {
  const { state, audits } = useAudited();
  const card = useMemo(() => vendorScorecard(vendor, state, Object.fromEntries(Object.entries(audits).map(([id, a]) => [id, a.findings]))), [vendor, state, audits]);
  return (
    <section aria-label="Vendor scorecard" className="mb-5 rounded-2xl bg-card px-4 py-3 ring-1 ring-line">
      <p className="text-sm">{card.summary}</p>
      {card.findings > 0 && <dl className="mt-2 grid grid-cols-4 gap-2 text-center text-xs"><div><dt className="text-muted-foreground">Findings</dt><dd className="num text-base font-semibold">{card.findings}</dd></div><div><dt className="text-muted-foreground">Open</dt><dd className="num text-base font-semibold text-warn">{card.open}</dd></div><div><dt className="text-muted-foreground">Confirmed</dt><dd className="num text-base font-semibold">{card.confirmed}</dd></div><div><dt className="text-muted-foreground">Dismissed</dt><dd className="num text-base font-semibold">{card.dismissed}</dd></div></dl>}
    </section>
  );
}

/** Vendors that look like one company written two ways. Merging moves everything across and is only done when you confirm. */
export function DuplicateVendors() {
  const { state } = useAudited();
  const pairs = useMemo(() => duplicateVendorPairs(state.vendors, state.invoices), [state.vendors, state.invoices]);
  const [asking, setAsking] = useState<string | null>(null);
  if (pairs.length === 0) return null;
  return (
    <section aria-label="Possible duplicate vendors" className="mb-4 rounded-2xl bg-card p-4 ring-1 ring-line">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><GitMerge className="size-4" aria-hidden />Same vendor twice?</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Split vendors hide price history and duplicate bills. Merge only if they really are the same company.</p>
      <ul className="mt-2 divide-y divide-line">
        {pairs.map((p) => {
          const key = `${p.keep.id}:${p.drop.id}`;
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0"><Link href={`/vendors/${p.drop.id}`} className="font-medium hover:underline">{p.drop.name}</Link> → <Link href={`/vendors/${p.keep.id}`} className="font-medium hover:underline">{p.keep.name}</Link><span className="block text-xs text-muted-foreground">{p.reason}</span></span>
              {asking === key
                ? <span className="flex gap-2"><Button size="sm" variant="primary" onClick={() => { actions.mergeVendors(p.keep.id, p.drop.id); setAsking(null); }}>Yes, merge into {p.keep.name}</Button><Button size="sm" onClick={() => setAsking(null)}>Cancel</Button></span>
                : <Button size="sm" onClick={() => setAsking(key)}>Merge…</Button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
