"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Minimal dependency-free SVG charts. Always paired with an accessible text summary by the caller. */

export function Sparkline({ values, tone = "neutral", className }: { values: number[]; tone?: "neutral" | "warn" | "bad" | "ok"; className?: string }) {
  if (values.length < 2) return <span className="text-xs text-subtle">—</span>;
  const w = 72, h = 24, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(" ");
  const stroke = tone === "bad" ? "var(--color-bad)" : tone === "warn" ? "var(--color-warn)" : tone === "ok" ? "var(--color-ok)" : "var(--muted-foreground)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-6 w-[72px]", className)} role="img" aria-label={`Trend over ${values.length} invoices`}>
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={stroke} fillOpacity="0.08" stroke="none" />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface Point { label: string; value: number; flagged?: boolean }

export function LineChart({ points, average, currency, ariaLabel }: { points: Point[]; average?: number | null; currency: string; ariaLabel: string }) {
  // Measure the container so the viewBox matches the rendered width: labels stay 12px on every screen.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const hasPoints = points.length > 0; // the wrapper only exists once there are points, so observing has to start then
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el); setWidth(Math.round(el.clientWidth) || 480);
    return () => ro.disconnect();
  }, [hasPoints]);
  const W = Math.max(260, width), H = width < 420 ? 190 : 210, L = width < 420 ? 48 : 56, R = 14, T = 16, B = 30;
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
    <div ref={box} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="1 4" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted-foreground)">{fmt(t)}</text>
        </g>
      ))}
      {average ? <line x1={L} x2={W - R} y1={y(average)} y2={y(average)} stroke="var(--foreground)" strokeDasharray="5 4" strokeOpacity="0.55" /> : null}
      {average ? <text x={W - R} y={y(average) - 6} textAnchor="end" fontSize="12" fontWeight="600" fill="var(--foreground)">Average {fmt(average)}</text> : null}
      <polygon fill="var(--chart-1)" fillOpacity="0.07" points={`${x(0)},${H - B} ${points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} ${x(points.length - 1)},${H - B}`} />
      <polyline fill="none" stroke="var(--chart-1)" strokeWidth="2.25" strokeLinejoin="round" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
      {points.map((p, i) => (
        <g key={i}>
          {p.flagged ? <rect x={x(i) - 5.5} y={y(p.value) - 5.5} width="11" height="11" transform={`rotate(45 ${x(i)} ${y(p.value)})`} fill="var(--chart-3)" stroke="var(--card)" strokeWidth="1.5"><title>{`${p.label}: ${fmt(p.value)} (has findings)`}</title></rect>
            : <circle cx={x(i)} cy={y(p.value)} r={3.5} fill="var(--chart-1)" stroke="var(--card)" strokeWidth="1.5"><title>{`${p.label}: ${fmt(p.value)}`}</title></circle>}
          {(points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">{p.label}</text>}
        </g>
      ))}
    </svg>
    </div>
  );
}

