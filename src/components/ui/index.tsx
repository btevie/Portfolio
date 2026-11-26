"use client";
import Link from "next/link";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Classification, Confidence, Severity } from "@/lib/types";

/* ---------- Buttons ---------- */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
    variant === "primary" && "bg-primary text-white hover:bg-primary-hover",
    variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-canvas",
    variant === "ghost" && "text-muted hover:bg-primary-soft hover:text-ink",
    variant === "danger" && "border border-bad-line bg-surface text-bad hover:bg-bad-bg",
    extra,
  );
}

export function Button({ variant, size, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...p} />;
}

export function LinkButton({ href, variant, size, className, children }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return <Link href={href} className={buttonClass(variant, size, className)}>{children}</Link>;
}

/* ---------- Layout ---------- */
export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line bg-surface", className)} {...p}>{children}</div>;
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-full bg-primary-soft text-primary"><Icon className="size-5" aria-hidden /></span>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------- Status ---------- */
const CLASS_META: Record<Classification, { label: string; cls: string; Icon: LucideIcon }> = {
  CLEAR: { label: "Clear", cls: "border-ok-line bg-ok-bg text-ok", Icon: CheckCircle2 },
  REVIEW_NEEDED: { label: "Review needed", cls: "border-warn-line bg-warn-bg text-warn", Icon: AlertTriangle },
  LIKELY_ERROR: { label: "Likely error", cls: "border-bad-line bg-bad-bg text-bad", Icon: ShieldAlert },
};

export function ClassBadge({ value, size = "md" }: { value: Classification; size?: "sm" | "md" }) {
  const { label, cls, Icon } = CLASS_META[value];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-wide", size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[11px]", cls)}>
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />{label}
    </span>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" | "primary"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
      tone === "neutral" && "border-line bg-canvas text-muted",
      tone === "ok" && "border-ok-line bg-ok-bg text-ok",
      tone === "warn" && "border-warn-line bg-warn-bg text-warn",
      tone === "bad" && "border-bad-line bg-bad-bg text-bad",
      tone === "primary" && "border-primary/20 bg-primary-soft text-primary", className)}>{children}</span>
  );
}

export const SeverityPill = ({ value }: { value: Severity }) => (
  <Pill tone={value === "high" ? "bad" : value === "medium" ? "warn" : "neutral"}>{value[0].toUpperCase() + value.slice(1)} severity</Pill>
);
export const ConfidencePill = ({ value }: { value: Confidence }) => (
  <Pill tone="primary">{value[0].toUpperCase() + value.slice(1)} confidence</Pill>
);

/* ---------- Forms ---------- */
export const fieldClass = "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-subtle transition-colors hover:border-subtle disabled:bg-canvas";

export function Field({ label, htmlFor, hint, children, flagged }: { label: string; htmlFor: string; hint?: string; children: ReactNode; flagged?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">{label}</label>
        {flagged && <span className="rounded bg-warn-bg px-1.5 py-0.5 text-[11px] font-semibold text-warn">Please confirm</span>}
      </div>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; id: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">{label}</label>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-150", checked ? "bg-primary" : "bg-line-strong")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-150", checked && "translate-x-5")} />
      </button>
    </div>
  );
}

/* ---------- Modal (native <dialog>: focus trap + Esc for free) ---------- */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref} onClose={onClose} aria-labelledby="modal-title"
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cn("m-auto w-[calc(100%-2rem)] rounded-lg border border-line bg-surface p-0 shadow-xl", wide ? "max-w-2xl" : "max-w-md")}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 id="modal-title" className="text-[15px] font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-canvas"><X className="size-4" /></button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

