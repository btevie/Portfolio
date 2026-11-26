import { cn } from "@/lib/cn";

/** Minimal dependency-free SVG charts. Always paired with an accessible text summary by the caller. */

export function Sparkline({ values, tone = "neutral", className }: { values: number[]; tone?: "neutral" | "bad" | "ok"; className?: string }) {
  if (values.length < 2) return <span className="text-xs text-subtle">—</span>;
  const w = 72, h = 24, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(" ");
  const stroke = tone === "bad" ? "#991b1b" : tone === "ok" ? "#166534" : "#64748b";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-6 w-[72px]", className)} role="img" aria-label={`Trend over ${values.length} invoices`}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface Point { label: string; value: number; flagged?: boolean }

export function LineChart({ points, average, currency, ariaLabel }: { points: Point[]; average?: number | null; currency: string; ariaLabel: string }) {
  const W = 640, H = 220, L = 52, R = 16, T = 16, B = 28;
  if (points.length === 0) return null;
  const vals = points.map((p) => p.value).concat(average ? [average] : []);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || hi || 1) * 0.15;
  const min = Math.max(0, lo - pad), max = hi + pad;
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const ticks = [min, (min + max) / 2, max];
  const fmt = (v: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e4e7eb" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b">{fmt(t)}</text>
        </g>
      ))}
      {average ? <line x1={L} x2={W - R} y1={y(average)} y2={y(average)} stroke="#64748b" strokeDasharray="4 4" /> : null}
      <polyline fill="none" stroke="#1e3a5f" strokeWidth="2" strokeLinejoin="round" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={p.flagged ? 5 : 3.5} fill={p.flagged ? "#b45309" : "#1e3a5f"} stroke="#fff" strokeWidth="1.5"><title>{`${p.label}: ${fmt(p.value)}`}</title></circle>
          {(points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">{p.label}</text>}
        </g>
      ))}
    </svg>
  );
}

export function BarChart({ data, currency, ariaLabel }: { data: { label: string; total: number }[]; currency: string; ariaLabel: string }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const fmt = (v: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  return (
    <div role="img" aria-label={ariaLabel} className="flex h-44 items-end gap-3 pt-6">
      {data.map((d, i) => (
        <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
          <span className="num text-[11px] text-muted">{d.total ? fmt(d.total) : "—"}</span>
          <div className={cn("w-full rounded-t-[3px] transition-[height] duration-300", i === data.length - 1 ? "bg-primary" : "bg-primary/25")} style={{ height: `${Math.max((d.total / max) * 100, d.total ? 3 : 0)}%` }} />
          <span className="text-[11px] text-subtle">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
