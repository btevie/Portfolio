"use client";
import { useDeferredValue, useMemo } from "react";
import { HeartPulse } from "lucide-react";
import { useAppState } from "@/lib/data/store";
import { parseText } from "@/lib/extraction/parsers";
import { cn } from "@/lib/cn";

type Mark = "found" | "guess" | "missing";
const DOT: Record<Mark, string> = { found: "bg-ok", guess: "bg-warn", missing: "bg-muted-foreground/40" };
const WORD: Record<Mark, string> = { found: "found", guess: "guessed, please check", missing: "not found" };

/** As you paste, shows what Overbill understood: each field marked found, guessed or missing. Nothing is saved until you check the invoice. */
export function PastePreview({ text }: { text: string }) {
  const currency = useAppState().settings.currency;
  const deferred = useDeferredValue(text);
  const result = useMemo(() => {
    if (!deferred.trim()) return null;
    try { return { e: parseText(deferred, currency) }; } catch (err) { return { error: err instanceof Error ? err.message : "Not understood yet." }; }
  }, [deferred, currency]);
  if (!result) return null;
  if ("error" in result) return <p role="status" className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Not understood yet: {result.error}</p>;
  const e = result.e;
  const low = new Set(e.lowConfidence);
  const mark = (v: string, k: string): Mark => (!v ? "missing" : low.has(k as never) || e.notes ? "guess" : "found");
  const rows: [string, string, Mark][] = [
    ["Vendor", e.vendorName, mark(e.vendorName, "vendorName")], ["Invoice number", e.number, mark(e.number, "number")], ["Date", e.date, mark(e.date, "date")],
    ["Lines", e.lines.length ? `${e.lines.length}` : "", e.notes ? "guess" : e.lines.length ? "found" : "missing"], ["Total", e.total, mark(e.total, "total")],
  ];
  return (
    <div role="status" aria-label="What Overbill understood" className="mt-2 rounded-lg bg-muted/60 px-3 py-2">
      <p className="mb-1 text-xs font-medium text-muted-foreground">What Overbill understood so far</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {rows.map(([label, value, m]) => <li key={label} className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("size-2 rounded-full", DOT[m])} /><span className="text-muted-foreground">{label}:</span><span className="font-medium">{value || "—"}</span><span className="sr-only"> ({WORD[m]})</span></li>)}
        {e.medical && <li className="inline-flex items-center gap-1 font-medium text-sky-800 dark:text-sky-200"><HeartPulse className="size-3" aria-hidden />Looks medical</li>}
      </ul>
    </div>
  );
}
