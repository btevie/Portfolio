"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";

/* Chart + KPI primitives adapted from the Layro ChartCard source (revenue-charts-kpi).
   Opaque surfaces, Overbill tokens (--chart-1…5 live in globals.css), no glass, no squircle.
   Rules: colour follows the series slot, one y-axis, thin marks, text never wears series colour,
   legend for 2+ series, tooltip + visually hidden data table on every chart. */

export interface Series { key: string; label: string; slot?: 1 | 2 | 3 | 4 | 5 }
const color = (s: Series, i: number) => `var(--chart-${s.slot ?? (i % 5) + 1})`;
const AXIS = { fill: "var(--color-subtle)", fontSize: 11 };
const defaultFormat = (v: number) => v.toLocaleString();

/* ---- card (title is a real heading) ---- */
export interface ChartCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode;
}
export function ChartCard({ title, subtitle, actions, className, children, ...rest }: ChartCardProps) {
  return (
    <figure className={cn("m-0 grid content-start gap-3 rounded-xl bg-surface p-4 sm:p-5 text-ink ring-1 ring-border shadow-xs", className)} {...rest}>
      <figcaption className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
        </div>
        {actions}
      </figcaption>
      {children}
    </figure>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-hidden>
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 rounded-[3px]" style={{ background: color(s, i) }} />{s.label}</li>
      ))}
    </ul>
  );
}

interface TipProps { active?: boolean; payload?: { dataKey?: unknown; name?: unknown; value?: unknown }[]; label?: unknown; series: Series[]; format: (v: number) => string; labelFormat?: (l: string) => string }
function ChartTooltip({ active, payload, label, series, format, labelFormat }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[150px] rounded-lg bg-raised px-3 py-2 text-xs text-ink shadow-lg ring-1 ring-border">
      {label !== undefined && <p className="mb-1.5 font-semibold">{labelFormat ? labelFormat(String(label)) : String(label)}</p>}
      <ul className="grid gap-1">
        {payload.map((p, n) => {
          const i = series.findIndex((s) => s.key === p.dataKey);
          const s = series[i] ?? { key: String(p.dataKey ?? n), label: String(p.name ?? p.dataKey) };
          return (
            <li key={s.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-[3px]" style={{ background: color(s, Math.max(i, 0)) }} />{s.label}</span>
              <span className="num font-semibold">{format(Number(p.value))}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DataTableFallback<T extends Record<string, unknown>>({ caption, data, xKey, series, format }: { caption: string; data: T[]; xKey: string; series: Series[]; format: (v: number) => string }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead><tr><th scope="col">{xKey}</th>{series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
        <tbody>{data.map((row, i) => <tr key={i}><th scope="row">{String(row[xKey])}</th>{series.map((s) => <td key={s.key}>{format(Number(row[s.key]))}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

interface CartesianProps<T> {
  data: T[]; xKey: keyof T & string; series: Series[]; format?: (v: number) => string; xFormat?: (v: string) => string;
  height?: number; description: string; className?: string; yWidth?: number;
}

export function AreaTrend<T extends Record<string, unknown>>({ data, xKey, series, format = defaultFormat, xFormat, height = 220, description, className, yWidth = 56 }: CartesianProps<T>) {
  const id = React.useId().replace(/:/g, "");
  return (
    <div className={cn("grid gap-3", className)}>
      <Legend series={series} />
      <div role="img" aria-label={description} style={{ height }}>
        <div aria-hidden className="h-full w-full"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height }}>
          <AreaChart accessibilityLayer={false} data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <defs>{series.map((s, i) => (
              <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color(s, i)} stopOpacity={0.12} /><stop offset="100%" stopColor={color(s, i)} stopOpacity={0.12} />
              </linearGradient>))}</defs>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey={xKey as string} tickLine={false} axisLine={false} tick={AXIS} tickMargin={8} tickFormatter={xFormat} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} tick={AXIS} tickFormatter={format} width={yWidth} />
            <RTooltip cursor={{ stroke: "var(--color-subtle)", strokeWidth: 1 }} content={<ChartTooltip series={series} format={format} labelFormat={xFormat} />} />
            {series.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(s, i)} strokeWidth={2} fill={`url(#${id}-${s.key})`} dot={{ r: 3, strokeWidth: 0, fill: color(s, i) }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-surface)", fill: color(s, i) }} isAnimationActive={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer></div>
      </div>
      <DataTableFallback caption={description} data={data} xKey={xKey} series={series} format={format} />
    </div>
  );
}

