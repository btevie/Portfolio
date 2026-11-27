"use client";
import { AreaTrend } from "@/components/charts/kpi-charts";
import { CountUp } from "@/components/ui";
import { cn } from "@/lib/cn";

type Month = { label: string; total: number; flagged: number };

/** Latest month's spend as the headline, with the monthly trend line underneath. */
export function SpendCard({ months, format }: { months: Month[]; format: (n: number) => string }) {
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const delta = prev && prev.total > 0 ? Math.round(((cur.total - prev.total) / prev.total) * 1000) / 10 : null;
  return (
    <section aria-label="Spending" className="soft rounded-3xl p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">Spending in {cur.label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="num text-3xl leading-none font-semibold tracking-tight sm:text-4xl"><CountUp value={cur.total} format={format} /></p>
        {delta !== null && <p className={cn("text-xs font-medium", delta > 0 ? "text-warn" : "text-ok")}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta)}% vs {prev.label}</p>}
      </div>
      <div className="mt-3">
        <AreaTrend data={months} xKey="label" height={135} format={format}
          description={`Monthly invoiced spend and the part on flagged invoices, last ${months.length} months: ${months.map((x) => `${x.label} ${format(x.total)}, flagged ${format(x.flagged)}`).join("; ")}`}
          series={[{ key: "total", label: "Invoiced", slot: 1 }, { key: "flagged", label: "On flagged invoices", slot: 3 }]} />
      </div>
    </section>
  );
}
