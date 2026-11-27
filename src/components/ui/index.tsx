"use client";
/**
 * Overbill UI kit: thin, task-shaped wrappers over the shadcn/ui primitives in this folder.
 * Every screen imports from here so buttons, surfaces, status labels, forms and dialogs stay consistent.
 */
import { SelectMenu } from "@/components/ui/select-menu";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ShieldAlert, type LucideIcon } from "lucide-react";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import type { Classification, Confidence, Severity } from "@/lib/types";
import { Button as ShButton, buttonVariants } from "@/components/ui/button";
import { Card as ShCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/* ---------- Buttons ---------- */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT = { primary: "default", secondary: "outline", ghost: "ghost", danger: "destructive" } as const;

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn(buttonVariants({ variant: VARIANT[variant], size: size === "sm" ? "sm" : "lg" }), size === "md" && "h-9 px-3.5", extra);
}

export function Button({ variant = "secondary", size = "md", className, ...p }: Omit<React.ComponentProps<typeof ShButton>, "variant" | "size"> & { variant?: Variant; size?: Size }) {
  return <ShButton variant={VARIANT[variant]} size={size === "sm" ? "sm" : "lg"} className={cn(size === "md" && "h-9 px-3.5", className)} {...p} />;
}

export function LinkButton({ href, variant, size, className, children }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return <Link href={href} className={cn("pointer-coarse:min-h-11", buttonClass(variant, size, className))}>{children}</Link>;
}

/* ---------- Layout ---------- */
const EASE = [0.23, 1, 0.32, 1] as const;
const MotionCard = motion.create(ShCard);
/** shadcn Card that eases in on mount (Framer; reduced motion honoured by MotionConfig). */
export function Card({ className, children, ...p }: Omit<React.HTMLAttributes<HTMLDivElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart">) {
  return (
    <MotionCard initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}
      className={cn("gap-0 py-0 shadow-xs dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)]", className)} {...p}>{children}</MotionCard>
  );
}

/** Number that counts up to its value on mount / change. Honours reduced motion. */
export function CountUp({ value, format = (n) => String(Math.round(n)), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const from = useRef(value * 0.7); // start near the real value so a slow load never flashes a misleading 0
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (reduce) { el.textContent = format(value); return; }
    const c = animate(from.current, value, { duration: 0.9, ease: EASE, onUpdate: (v) => { el.textContent = format(v); from.current = v; } });
    return () => c.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce]);
  return <span ref={ref} className={className}>{format(value)}</span>;
}

/** Dashboard-style KPI cell: eyebrow, count-up value, optional hint. */
export function Stat({ label, value, format, tone, hint, className, aside }: { label: string; value: number; format?: (n: number) => string; tone?: "ok" | "warn" | "bad"; hint?: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <div className={cn("p-4 sm:p-5", className)}>
      <p className="eyebrow !text-xs">{label}</p>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className={cn("num text-2xl font-semibold tracking-tight", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}><CountUp value={value} format={format} /></p>
        {aside}
      </div>
      {hint && <p className="mt-1 hidden text-xs text-muted-foreground sm:block">{hint}</p>}
    </div>
  );
}

/** Small +/- change pill: direction + colour + sign, never colour alone. */
export function Delta({ pct, limit = 5 }: { pct: number | null; limit?: number }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (pct === 0) return <span className="text-xs text-muted-foreground">No change</span>;
  const up = pct >= limit, down = pct < 0;
  return <Pill tone={up ? "warn" : down ? "ok" : "neutral"} className="num px-1.5 text-xs">{up ? "▲" : down ? "▼" : "•"} {pct > 0 ? "+" : ""}{pct}%</Pill>;
}

/** Table row / list item that staggers in. `i` is the row index (capped so long lists don't lag). */
export function MotionRow({ i = 0, className, children, onClick }: { i?: number; className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <motion.tr onClick={onClick} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE, delay: Math.min(i, 10) * 0.03 }} className={className}>{children}</motion.tr>
  );
}
export function MotionBlock({ i = 0, className, children }: { i?: number; className?: string; children: ReactNode }) {
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: Math.min(i, 8) * 0.06 }} className={className}>{children}</motion.div>;
}
export function MotionItem({ i = 0, className, children }: { i?: number; className?: string; children: ReactNode }) {
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE, delay: Math.min(i, 10) * 0.03 }} className={className}>{children}</motion.li>
  );
}

/** Filter tabs with a sliding active pill (shared layout animation). */
export function PillTabs<T extends string>({ value, onChange, items, label, id }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[]; label: string; id: string }) {
  return (
    <>
    <SelectMenu label={label} className="mb-3 sm:hidden" value={value} onChange={(v) => onChange(v as T)} options={items.map((it) => ({ value: it.value, label: `${it.label}${it.count !== undefined ? ` (${it.count})` : ""}` }))} />
    <div role="group" aria-label={label} className="hidden gap-5 overflow-x-auto border-b border-line sm:flex">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button key={it.value} type="button" aria-pressed={active} onClick={() => onChange(it.value)}
            className={cn("relative inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-sm text-sm font-medium outline-none transition-colors focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <span>{it.label}</span>
            {it.count !== undefined && <span className="num text-xs text-subtle">{it.count}</span>}
            {active && <motion.span layoutId={`pill-${id}`} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-selected" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          </button>
        );
      })}
    </div>
    </>
  );
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-5 sm:mb-8 sm:pb-6">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1.5 hidden max-w-2xl text-sm text-muted-foreground sm:block">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon aria-hidden /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}

/* ---------- Status ----------
   Three distinct tiers, never blended:
   - Possible anomaly (Review needed): a signal the engine can't be sure about
   - Likely error: strong evidence, still unconfirmed until the user decides
   - Clear: nothing found
   Confirmed errors and recovered money are shown with <Pill tone="ok"> / the recovery status, not these badges. */
const CLASS_META: Record<Classification, { label: string; hint: string; cls: string; Icon: LucideIcon }> = {
  CLEAR: { label: "Nothing flagged", hint: "Our checks found nothing unusual. This is not a guarantee the invoice is correct", cls: "border-ok-line bg-ok-bg text-ok", Icon: CheckCircle2 },
  REVIEW_NEEDED: { label: "Review needed", hint: "Possible problem, not confirmed", cls: "border-warn-line bg-warn-bg text-warn", Icon: AlertTriangle },
  LIKELY_ERROR: { label: "Likely error", hint: "Strong evidence, but unconfirmed until you decide", cls: "border-bad-line bg-bad-bg text-bad", Icon: ShieldAlert },
};

export function ClassBadge({ value, size = "md" }: { value: Classification; size?: "sm" | "md" }) {
  const { label, hint, cls, Icon } = CLASS_META[value];
  return (
    <Badge variant="outline" title={hint} className={cn("h-auto gap-1.5 rounded-md font-semibold", size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-xs", cls)}>
      <Icon aria-hidden />{label}
    </Badge>
  );
}

export function Pill({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" | "primary" | "info"; className?: string; title?: string }) {
  return (
    <Badge variant="outline" title={title} className={cn("h-auto gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
      tone === "neutral" && "bg-muted text-muted-foreground",
      tone === "ok" && "border-ok-line bg-ok-bg text-ok",
      tone === "warn" && "border-warn-line bg-warn-bg text-warn",
      tone === "bad" && "border-bad-line bg-bad-bg text-bad",
      tone === "primary" && "border-primary/20 bg-accent text-accent-foreground",
      tone === "info" && "border-sky-600/30 bg-sky-600/10 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300", className)}>{children}</Badge>
  );
}

function Pips({ level }: { level: 1 | 2 | 3 }) {
  return <span className="inline-flex gap-0.5" aria-hidden>{[1, 2, 3].map((n) => <span key={n} className={cn("h-2.5 w-1 rounded-[1px] bg-current", n > level && "opacity-20")} />)}</span>;
}
const LEVEL = { low: 1, medium: 2, high: 3 } as const;
export const SeverityPill = ({ value }: { value: Severity }) => (
  <Pill tone={value === "high" ? "bad" : value === "medium" ? "warn" : "neutral"}><Pips level={LEVEL[value]} />{value[0].toUpperCase() + value.slice(1)} severity</Pill>
);
export const ConfidencePill = ({ value }: { value: Confidence }) => (
  <Pill tone="primary"><Pips level={LEVEL[value]} />{value[0].toUpperCase() + value.slice(1)} confidence</Pill>
);

/* ---------- Forms ---------- */
export const fieldClass = "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60";

export function Field({ label, htmlFor, hint, children, flagged }: { label: string; htmlFor: string; hint?: string; children: ReactNode; flagged?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
        {flagged && <Pill tone="warn" className="px-1.5 text-xs font-semibold">Please confirm</Pill>}
      </div>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; id: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">{label}</label>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ---------- Modal (shadcn Dialog: focus trap, Esc, scroll lock) ---------- */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn("max-h-[90dvh] overflow-y-auto sm:max-w-md", wide && "sm:max-w-2xl")}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{title}</DialogDescription></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Motion helpers (reduced motion is honoured globally by <MotionConfig reducedMotion="user">) ---------- */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }} style={{ overflow: "hidden" }}>
      {children}
    </motion.div>
  );
}

/** Expanding section: a real button (aria-expanded) + Framer height/opacity reveal. */
export function Disclosure({ title, subtitle, aside, defaultOpen = false, children, className }: { title: ReactNode; subtitle?: ReactNode; aside?: ReactNode; defaultOpen?: boolean; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5">
        <span><span className="block text-sm font-semibold">{title}</span>{subtitle && <span className="mt-0.5 block text-xs text-muted-foreground">{subtitle}</span>}</span>
        <span className="flex shrink-0 items-center gap-3">{aside}<ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden /></span>
      </button>
      <AnimatePresence initial={false}>
        {open && <Reveal><div id={id} className="border-t p-4 sm:p-5">{children}</div></Reveal>}
      </AnimatePresence>
    </section>
  );
}

/** Animated progress ring: a quick read of "how far along", with the percentage in the middle. */
export function ProgressRing({ pct, size = 52, label }: { pct: number; size?: number; label: string }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct));
  return (
    <div role="img" aria-label={`${label}: ${Math.round(v)}%`} className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={5} className="stroke-muted" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={5} strokeLinecap="round" className="stroke-primary" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v / 100) }} transition={{ duration: 1, ease: EASE, delay: 0.2 }} />
      </svg>
      <span className="num absolute text-xs font-semibold">{Math.round(v)}%</span>
    </div>
  );
}
