"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpDown, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Search, X } from "lucide-react";
import { D, formatMoney } from "@/lib/audit/money";
import { parseISO } from "@/lib/audit/normalize";
import { useAudited } from "@/lib/data/hooks";
import { isSimulated } from "@/lib/evidence";
import { atStakeByCurrency, effectiveClassification, invoiceExposure, isOpen, paymentStatusAt } from "@/lib/data/selectors";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CreditStatusPill } from "@/components/credit-tracker";
import { allCreditPositions, creditBalanceByCurrency, creditsToResolve, formatBalances } from "@/lib/credits";
import { ClassBadge, CountUp, EmptyState, LinkButton, MotionItem, MotionRow, Pill } from "@/components/ui";

const SORTS = {
  date_desc: "Newest",
  date_asc: "Oldest",
  amount_desc: "Amount",
  vendor: "Vendor",
} as const;

const FILTERS = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs review" },
  { value: "clear", label: "Nothing flagged" },
  { value: "credits", label: "Credit notes" },
] as const;

/** Soft, friendly vendor avatar: a stable hue per vendor so the list is scannable at a glance. */
function VendorAvatar({ name, className }: { name: string; className?: string }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  // Hue lives in a CSS variable so the pastel adapts to the theme: light chip on light cards, deep chip on dark cards.
  return <span aria-hidden style={{ "--h": h } as React.CSSProperties} className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-[oklch(0.86_0.09_var(--h))] text-[11px] font-bold text-[oklch(0.28_0.07_var(--h))] dark:bg-[oklch(0.36_0.07_var(--h))] dark:text-[oklch(0.92_0.06_var(--h))]", className)}>{initials}</span>;
}

const monthLabel = (iso: string) => { const t = parseISO(iso); return t ? new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "Undated"; };

const card = "rounded-[28px] bg-card ring-1 ring-border shadow-xs";

const severityOrder = { high: 0, medium: 1, low: 2 } as const;

/** Themed sort menu. A native <select> pops up an OS-styled (often dark, often misplaced) list, so this renders its own. */
function SortMenu({ value, onChange }: { value: keyof typeof SORTS; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" aria-label="Sort invoices" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-muted px-3.5 text-sm font-medium outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-95">
        <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden />{SORTS[value]}<ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul role="listbox" aria-label="Sort invoices" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="absolute top-full right-0 z-30 mt-2 w-44 origin-top-right overflow-hidden rounded-2xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-border">
            {Object.entries(SORTS).map(([key, label]) => (
              <li key={key} role="option" aria-selected={key === value}>
                <button type="button" onClick={() => { onChange(key); setOpen(false); }}
                  className={cn("flex h-11 w-full cursor-pointer items-center justify-between rounded-xl px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted", key === value && "font-semibold")}>
                  {label}{key === value && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function InvoiceList() {
  const { state, audits } = useAudited();
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQState] = useState(() => sp.get("q") ?? ""); // local mirror so typing never lags behind the URL
  const urlQ = sp.get("q") ?? "";
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);
  if (seenUrlQ !== urlQ) { setSeenUrlQ(urlQ); setQState(urlQ); } // the top-bar search pushes ?q= while this page is already mounted
  const status = sp.get("status") ?? "all";
  const vendorFilter = sp.get("vendor") ?? "";
  const payFilter = sp.get("pay") ?? "";
  const requestedSort = sp.get("sort") ?? "date_desc";
  const sort = requestedSort in SORTS ? (requestedSort as keyof typeof SORTS) : "date_desc";
  const pageSize = 8;
  const requestedPage = Math.max(1, Number(sp.get("page") ?? 1) || 1);

  // Update the current URL so search, filters, and sorting remain shareable.
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (key !== "page") next.delete("page");
    if (value && !(key === "status" && value === "all") && !(key === "sort" && value === "date_desc")) next.set(key, value);
    else next.delete(key);
    window.history.replaceState(null, "", `/invoices${next.toString() ? `?${next}` : ""}`);
    if (key === "page") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const setQ = (value: string) => { setQState(value); set("q", value); };

  const creditPos = useMemo(() => new Map(allCreditPositions(state).map((p) => [p.credit.id, p])), [state]);
  const creditsToDo = useMemo(() => creditsToResolve(state), [state]);
  const counts = useMemo(() => {
    const result = { all: state.invoices.length, attention: 0, clear: 0, overdue: 0, credits: 0 };
    for (const invoice of state.invoices) {
      if (invoice.isCredit) { result.credits += 1; continue; }
      const classification = effectiveClassification(state, audits[invoice.id]);
      if (classification === "CLEAR") result.clear += 1;
      else {
        result.attention += 1;
        if (paymentStatusAt(invoice) === "overdue") result.overdue += 1;
      }
    }
    return result;
  }, [state, audits]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.invoices
      .map((invoice) => {
        const open = (audits[invoice.id]?.findings ?? []).filter((finding) => isOpen(state, finding))
          .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
        return {
          invoice,
          classification: effectiveClassification(state, audits[invoice.id]),
          finding: open[0],
          amountAtRisk: isSimulated(invoice) ? D(0) : invoiceExposure(open, invoice.total), // an invented bill has no real money at stake
          searchText: `${invoice.vendorName} ${invoice.number} ${invoice.isCredit ? "credit note" : ""} ${open.map((finding) => finding.title).join(" ")}`.toLowerCase(),
        };
      })
      .filter(({ classification, searchText, invoice }) =>
        (!vendorFilter || invoice.vendorId === vendorFilter) &&
        (!needle || searchText.includes(needle)) &&
        (!payFilter || (!invoice.isCredit && paymentStatusAt(invoice) === payFilter)) &&
        (status === "all" || (status === "credits" ? Boolean(invoice.isCredit) : !invoice.isCredit && (status === "attention" ? classification !== "CLEAR" : status === "clear" ? classification === "CLEAR" : classification === status.toUpperCase()))),
      )
      .sort((a, b) =>
        sort === "date_asc" ? (parseISO(a.invoice.date) ?? 0) - (parseISO(b.invoice.date) ?? 0)
          : sort === "amount_desc" ? a.invoice.currency.localeCompare(b.invoice.currency) || Number(b.invoice.total) - Number(a.invoice.total) /* never rank across currencies */
            : sort === "vendor" ? a.invoice.vendorName.localeCompare(b.invoice.vendorName)
              : (parseISO(b.invoice.date) ?? 0) - (parseISO(a.invoice.date) ?? 0) || b.invoice.createdAt - a.invoice.createdAt,
      );
  }, [state, audits, q, status, sort, vendorFilter, payFilter]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  // Money at stake per currency (never summed across currencies); duplicate-counting of overlapping findings is handled in the selector.
  const stakeAll = useMemo(() => atStakeByCurrency(state, audits), [state, audits]);
  const stake = { top: stakeAll.totals[0] ? ([stakeAll.totals[0].currency, stakeAll.totals[0].amount] as const) : undefined, others: stakeAll.totals.slice(1).map((t) => formatMoney(t.amount, t.currency)), tone: stakeAll.tone };

  // Month totals span all pages, so a month split across two pages shows the same honest count on both.
  const monthCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) { const l = monthLabel(r.invoice.date); m.set(l, (m.get(l) ?? 0) + 1); }
    return m;
  }, [rows]);

  // Group by month when sorted by date, so the list reads like a statement; other sorts stay flat.
  const groups = useMemo(() => {
    const indexed = pageRows.map((row, i) => ({ ...row, i }));
    if (sort !== "date_desc" && sort !== "date_asc") return [{ label: "", items: indexed }];
    const out: { label: string; items: typeof indexed }[] = [];
    for (const row of indexed) {
      const label = monthLabel(row.invoice.date);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(row); else out.push({ label, items: [row] });
    }
    return out;
  }, [pageRows, sort]);

  return (
    <div className="mx-auto max-w-3xl lg:max-w-none">
      <header className="mb-4 flex items-center justify-between gap-3 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">Search, filter and open any bill. Start with “Needs review”.</p>
        </div>
      </header>

      {state.invoices.length === 0 ? (
        <EmptyState icon={FileText} title="No invoices yet" action={<LinkButton href="/invoices/new" variant="primary">Upload an invoice</LinkButton>}>Your invoice history starts here. Upload a bill to begin.</EmptyState>
      ) : (
        <>
          {/* Summary: hero + swipeable stat cards (snap-scroll on phones, grid on desktop) */}
          <section aria-label="Summary" className="mb-4 grid grid-cols-[1.35fr_1fr_1fr] gap-3">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.97 }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }} className="min-w-0">
              <Link href="/recovery" aria-label={stake.top ? `Possible overcharges ${formatMoney(stake.top[1], stake.top[0])}. Open recovery tracker` : "No possible overcharges. Open recovery tracker"}
                className={cn("relative block h-full overflow-hidden rounded-2xl px-3.5 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 sm:py-5",
                  stake.tone === "bad" ? "bg-card text-warn ring-1 ring-line" : stake.tone === "warn" ? "bg-warn-bg text-warn ring-1 ring-warn-line" : "bg-primary text-primary-foreground")}>
                <div className="relative flex items-start justify-between"><p className="text-xs opacity-90 sm:text-sm">{stake.top ? "Possible overcharges" : "Nothing flagged"}</p>
                  <ArrowUpRight className="hidden size-4 opacity-70 sm:block" aria-hidden /></div>
                {stake.top ? (
                  <>
                    <p className="num relative mt-1 text-2xl font-semibold tracking-tight sm:mt-2 sm:text-3xl"><CountUp value={Number(stake.top[1])} format={(n) => formatMoney(n.toFixed(2), stake.top![0])} /></p>
                    {stake.others.length > 0 && <p className="relative mt-0.5 truncate text-[11px] opacity-80">+ {stake.others.join(" · ")}</p>}
                  </>
                ) : <p className="relative mt-1 text-lg font-semibold sm:mt-2 sm:text-2xl">No possible overcharges</p>}
              </Link>
            </motion.div>
            {([
              { label: "Needs review", value: counts.attention, hint: counts.overdue ? `${counts.overdue} past due` : "Open findings", tone: "text-warn" },
              { label: "Nothing flagged", value: counts.clear, hint: "Not a guarantee", tone: "text-ok" },
            ]).map((c, i) => (
              <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1], delay: 0.06 * (i + 1) }} className={cn(card, "flex min-w-0 flex-col justify-between rounded-2xl px-3.5 py-3.5 sm:px-5 sm:py-5")}>
                <p className="truncate text-xs text-muted-foreground sm:text-sm">{c.label}</p>
                <div className="flex items-baseline gap-2"><p className="num mt-1 text-xl font-semibold tracking-tight sm:mt-2 sm:text-3xl"><CountUp value={c.value} /></p><p className={cn("hidden truncate text-xs font-medium sm:block", c.tone)}>{c.hint}</p></div>
              </motion.div>
            ))}
          </section>

          <section aria-label="Invoice register" className={cn(card, "p-4 sm:p-6")}>
            <h2 className="sr-only">Invoice register</h2>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input aria-label="Search invoices" type="search" enterKeyHint="search" placeholder="Search invoices" value={q} onChange={(event) => setQ(event.target.value)} className="h-10 w-full min-w-0 rounded-full bg-muted pr-10 pl-10 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden" />
                {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-0.5 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground active:scale-90"><X className="size-4" aria-hidden /></button>}
              </div>
              <SortMenu value={sort} onChange={(v) => set("sort", v)} />
            </div>

            <div role="group" aria-label="Filter invoices by status" className={cn("mt-3 grid gap-2", counts.credits > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
              {FILTERS.filter((f) => f.value !== "credits" || counts.credits > 0).map((f) => {
                const active = status === f.value;
                return (
                  <motion.button key={f.value} type="button" aria-pressed={active} whileTap={{ scale: 0.94 }} onClick={() => set("status", f.value)}
                    className={cn("relative inline-flex h-10 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", active ? "text-primary-foreground" : "bg-muted text-foreground")}>
                    {active && <motion.span layoutId="inv-chip" className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                    <span className="relative truncate">{f.label}</span><span className="num relative text-xs">{counts[f.value]}</span>
                  </motion.button>
                );
              })}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="min-w-0"><span className="sr-only">Filter by vendor</span>
                <select value={state.vendors.some((v) => v.id === vendorFilter) ? vendorFilter : ""} onChange={(e) => set("vendor", e.target.value)} className="h-10 w-full min-w-0 cursor-pointer rounded-full bg-muted px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">All vendors</option>
                  {[...state.vendors].sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></label>
              <label className="min-w-0"><span className="sr-only">Filter by payment status</span>
                <select value={payFilter} onChange={(e) => set("pay", e.target.value)} className="h-10 w-full min-w-0 cursor-pointer rounded-full bg-muted px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">Any payment status</option><option value="unpaid">Unpaid</option><option value="overdue">Past due</option><option value="paid">Paid (set by you)</option>
                </select></label>
            </div>

            {status === "credits" && (
              <div role="status" className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm">
                {creditsToDo.length === 0
                  ? <p>Every credit note is confirmed applied or refunded.</p>
                  : <p><strong>{creditsToDo.length} credit note{creditsToDo.length === 1 ? " needs" : "s need"} you.</strong> {creditsToDo.filter((p) => p.status === "unmatched").length > 0 && <>{creditsToDo.filter((p) => p.status === "unmatched").length} not matched to a bill. </>}Open one to match it and confirm whether it was applied or refunded. Still unaccounted for: <span className="num font-semibold">{formatBalances(creditBalanceByCurrency(creditsToDo))}</span>. Credit notes are never counted in spending or amounts to pay.</p>}
              </div>
            )}
            {rows.length === 0 ? (
              <EmptyState icon={Search} title="Nothing matches that" action={<button type="button" onClick={() => { setQ(""); set("status", "all"); set("vendor", ""); set("pay", ""); }} className="min-h-11 text-sm font-semibold text-primary hover:underline">Clear filters</button>}>Try a different search or filter to see more invoices.</EmptyState>
            ) : (
              <>
                <div className="mt-5 space-y-2 md:hidden">
                  {groups.map((g) => (
                    <div key={g.label || "all"}>
                      {g.label && <div className="mb-2 flex items-center justify-between rounded-lg bg-muted px-3.5 py-2.5 text-xs text-muted-foreground"><span>{g.label}</span><span className="num">{monthCounts.get(g.label) ?? g.items.length} {(monthCounts.get(g.label) ?? g.items.length) === 1 ? "invoice" : "invoices"}</span></div>}
                      <ul aria-label={g.label ? `Invoices, ${g.label}` : "Invoices"}>
                        {g.items.map(({ invoice, classification, finding, amountAtRisk, i }) => (
                          <MotionItem key={invoice.id} i={i}>
                            <motion.div whileTap={{ scale: 0.98 }} className="rounded-2xl">
                              <Link href={`/invoices/${invoice.id}`} className="flex min-h-[4.5rem] items-center gap-3.5 rounded-2xl px-1.5 py-3.5 outline-none focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                                <VendorAvatar name={invoice.vendorName} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold leading-snug">{invoice.vendorName}</p>
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{invoice.extraction === "mock" && <span className="mr-1.5 font-semibold text-warn">Simulated ·</span>}{finding ? finding.title : `${invoice.number} · ${fmtDate(invoice.date)}`}</p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1"><p className="num text-sm font-semibold leading-tight">{formatMoney(invoice.total, invoice.currency)}</p>
                                  {amountAtRisk.gt(0)
                                    ? <span className={cn("num text-xs font-medium", "text-warn")}>{formatMoney(amountAtRisk, invoice.currency)} possible overcharge</span>
                                    : <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", invoice.isCredit ? (creditPos.get(invoice.id)?.status === "settled" ? "text-ok" : "text-warn") : paymentStatusAt(invoice) === "overdue" ? "text-bad" : classification === "CLEAR" ? "text-ok" : "text-warn")}><span aria-hidden className="size-1.5 rounded-full bg-current" />{invoice.isCredit ? `Credit · ${creditPos.get(invoice.id)?.status === "settled" ? "settled" : creditPos.get(invoice.id)?.status === "unmatched" ? "unmatched" : "to confirm"}` : isSimulated(invoice) ? "Simulated example" : paymentStatusAt(invoice) === "overdue" ? "Past due" : classification === "CLEAR" ? "Clear" : "Review"}</span>}
                                </div>
                              </Link>
                            </motion.div>
                          </MotionItem>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <caption className="sr-only">Invoices and audit results</caption>
                  <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="px-5 pt-4 pb-2 font-medium">Invoice</th><th scope="col" className="px-3 pt-4 pb-2 font-medium">Finding</th><th scope="col" className="px-3 pt-4 pb-2 text-right font-medium">Total</th><th scope="col" className="px-5 pt-4 pb-2 font-medium">Result</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {pageRows.map(({ invoice, classification, finding, amountAtRisk }, i) => (
                      <MotionRow key={invoice.id} i={i} onClick={() => router.push(`/invoices/${invoice.id}`)} className="group cursor-pointer transition-colors hover:bg-primary-soft/35">
                        <td className="px-5 py-4"><Link href={`/invoices/${invoice.id}`} className="font-semibold text-ink hover:text-primary hover:underline">{invoice.vendorName}</Link><div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground"><span>{invoice.number} · {fmtDate(invoice.date)}</span>{invoice.extraction === "mock" ? <Pill tone="warn" title="Figures are a scripted demo example, not read from your file">Simulated</Pill> : invoice.source === "upload" && <Pill tone="primary">Uploaded</Pill>}</div></td>
                        <td className="max-w-[320px] px-3 py-4"><p className="truncate text-sm text-ink">{invoice.isCredit ? "Credit note · not payable · not counted as spend" : finding?.title ?? "Nothing flagged"}</p>{!invoice.isCredit && paymentStatusAt(invoice) === "overdue" && <p className="mt-0.5 text-xs font-medium text-bad">Past due</p>}</td>
                        <td className="num px-3 py-4 text-right"><span className="font-semibold">{formatMoney(invoice.total, invoice.currency)}</span>{amountAtRisk.gt(0) && <p className="mt-0.5 text-xs font-medium text-warn">{formatMoney(amountAtRisk, invoice.currency)} possible overcharge</p>}</td>
                        <td className="px-5 py-4"><Link href={`/invoices/${invoice.id}`} className="inline-flex items-center gap-2">{invoice.isCredit ? (creditPos.get(invoice.id) ? <CreditStatusPill status={creditPos.get(invoice.id)!.status} /> : <Pill tone="info">Credit note</Pill>) : isSimulated(invoice) ? <Pill tone="bad">Simulated</Pill> : <ClassBadge value={classification} size="sm" />}<ArrowUpRight className="size-3.5 text-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /></Link></td>
                      </MotionRow>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > pageSize && <div className="mt-3 flex items-center justify-between px-1 py-1"><p className="text-xs text-muted-foreground">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length}</p><div className="flex gap-2"><button type="button" onClick={() => set("page", String(page - 1))} disabled={page === 1} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-muted px-4 text-sm font-medium transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="size-4" aria-hidden />Previous</button><button type="button" onClick={() => set("page", String(page + 1))} disabled={page === pageCount} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-muted px-4 text-sm font-medium transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">Next<ChevronRight className="size-4" aria-hidden /></button></div></div>}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
