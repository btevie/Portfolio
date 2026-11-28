"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";

const subscribe = (cb: () => void) => { const m = window.matchMedia("(max-width: 639px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const useIsPhone = () => useSyncExternalStore(subscribe, () => window.matchMedia("(max-width: 639px)").matches, () => false);

export type SelectOption = { value: string; label: string; hint?: string };

/**
 * Themed dropdown. A native <select> opens an OS-styled list that ignores the app theme (often dark on a light page)
 * and can appear far from the button, so this draws its own. `searchable` adds a filter box for long lists.
 */
export function SelectMenu({ id, label, value, options, onChange, searchable = false, className }: {
  id?: string; label: string; value: string; options: SelectOption[]; onChange: (v: string) => void; searchable?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const phone = useIsPhone();
  const current = options.find((o) => o.value === value);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const options_ = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  const close = () => { setOpen(false); setQuery(""); trigger.current?.focus(); }; // hand focus back to the button that opened the list

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!root.current?.contains(t) && !sheet.current?.contains(t)) { if (phone) close(); else { setOpen(false); setQuery(""); } /* desktop: the click already moved focus where the person pointed */ } };
    // On phones the list is a bottom sheet: lock the page behind it so only the list scrolls.
    const prev = document.body.style.overflow;
    if (phone) document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [open, phone]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((o) => `${o.value} ${o.label}`.toLowerCase().includes(needle)) : options;
  }, [options, query]);

  const choose = (v: string) => { onChange(v); close(); };

  // Move focus into the list when it opens (the search box when there is one, otherwise the selected option).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { if (searchable) search.current?.focus(); else (list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? options_()[0] ?? (phone ? sheet.current : null))?.focus(); }, 30);
    return () => clearTimeout(t);
  }, [open, phone, searchable]);

  const move = (e: React.KeyboardEvent) => {
    const items = options_();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? Math.min(items.length - 1, at + 1) : e.key === "ArrowUp" ? Math.max(0, at - 1) : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault(); items[to]?.focus();
  };
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !sheet.current) return;
    const f = Array.from(sheet.current.querySelectorAll<HTMLElement>("input, button:not([tabindex='-1'])"));
    const items = options_();
    const optionStop = items.find((x) => x.getAttribute("aria-selected") === "true") ?? items[0];
    const stops = [...f.filter((x) => x.getAttribute("role") !== "option"), ...(optionStop ? [optionStop] : [])];
    if (!stops.length) { e.preventDefault(); sheet.current.focus(); return; } // nothing to tab to: keep focus inside the dialog
    const first = stops[0], last = stops[stops.length - 1];
    const active = document.activeElement as HTMLElement | null;
    // Arrow keys can leave focus on any option, not just the selected one: treat every option as the single option stop.
    const onOption = active?.getAttribute("role") === "option";
    const current = onOption ? optionStop : active;
    if (e.shiftKey && current === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && onOption) { e.preventDefault(); (stops[stops.length - 2] ?? last).focus(); }
  };

  // One option is in the tab order. If the selected option is filtered out, the first match takes over.
  const tabStop = shown.some((o) => o.value === value) ? value : shown[0]?.value;

  const panel = (listClass: string) => (
    <>
      {searchable && (
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input ref={search} type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); options_()[0]?.focus(); } }}
            className="h-10 w-full rounded-full bg-muted pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden" />
        </div>
      )}
      {/* Options are the focusable elements themselves (no nested buttons); arrow keys move between them. */}
      <div ref={list} role="listbox" aria-label={label} onKeyDown={move} className={listClass}>
        {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches</p>}
        {shown.map((o) => (
          <button key={o.value} type="button" role="option" aria-selected={o.value === value} tabIndex={o.value === tabStop ? 0 : -1} onClick={() => choose(o.value)}
            className={cn("flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring", o.value === value && "font-semibold")}>
            <span className="min-w-0 truncate">{o.label}</span>
            {o.value === value ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div ref={root} className={cn("relative", className)}>
      <button ref={trigger} id={id} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
        className="flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-input bg-transparent px-3 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 truncate">{current?.label ?? value}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open && !phone && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="absolute top-full left-0 z-40 mt-2 w-full min-w-64 origin-top overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-border">
            {panel("max-h-64 overflow-y-auto overscroll-contain p-1.5")}
          </motion.div>
        )}
      </AnimatePresence>
      {phone && createPortal(
        <AnimatePresence>
          {open && (
            <div className="fixed inset-0 z-[60]">
              <motion.div aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40" onClick={close} />
              <motion.div ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} onKeyDown={trapTab} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 420, damping: 38 }}
                className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-3xl bg-popover pb-[env(safe-area-inset-bottom)] text-popover-foreground shadow-2xl">
                <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
                {panel("min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5")}
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
