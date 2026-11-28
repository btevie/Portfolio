"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, Download, FileSpreadsheet, FileText, PiggyBank, Search, Settings, Store, Upload, Wallet, LayoutDashboard, type LucideIcon } from "lucide-react";
import { actions, useAppState } from "@/lib/data/store";
import { cn } from "@/lib/cn";

type Item = { id: string; label: string; hint?: string; icon: LucideIcon; run: () => void };

/** ⌘K / Ctrl+K: jump to a page, vendor or invoice, check a bill, or mark one paid. */
export function CommandPalette() {
  const router = useRouter();
  const state = useAppState();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); setQ(""); setAt(0); }
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => router.push(href);
    const pages: Item[] = [
      { id: "p-new", label: "Check an invoice", hint: "Paste or upload", icon: Upload, run: go("/invoices/new") },
      { id: "p-dash", label: "Dashboard", icon: LayoutDashboard, run: go("/dashboard") },
      { id: "p-inv", label: "Invoices", icon: FileText, run: go("/invoices") },
      { id: "p-ven", label: "Vendors", icon: Store, run: go("/vendors") },
      { id: "p-rec", label: "Recovery", icon: PiggyBank, run: go("/recovery") },
      { id: "p-pay", label: "Pay run", icon: Wallet, run: go("/pay-run") },
      { id: "p-set", label: "Settings", icon: Settings, run: go("/settings") },
      { id: "p-acc", label: "Export findings for your accountant", hint: "Data", icon: FileSpreadsheet, run: go("/data") },
      { id: "p-bak", label: "Download a backup", hint: "Data", icon: Download, run: go("/data") },
    ];
    const vendors: Item[] = state.vendors.map((v) => ({ id: `v-${v.id}`, label: `Go to ${v.name}`, hint: "Vendor", icon: Store, run: go(`/vendors/${v.id}`) }));
    const bills = state.invoices.filter((i) => !i.isCredit);
    const invoices: Item[] = bills.map((i) => ({ id: `i-${i.id}`, label: `${i.vendorName} ${i.number}`.trim(), hint: "Invoice", icon: FileText, run: go(`/invoices/${i.id}`) }));
    const pay: Item[] = bills.filter((i) => i.paymentStatus !== "paid").map((i) => ({ id: `m-${i.id}`, label: `Mark paid: ${i.vendorName} ${i.number}`.trim(), hint: "Action", icon: CheckCheck, run: () => actions.setInvoicePaymentStatus(i.id, "paid") }));
    return [...pages, ...vendors, ...pay, ...invoices];
  }, [state.vendors, state.invoices, router]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? items.filter((i) => t.split(/\s+/).every((w) => i.label.toLowerCase().includes(w))) : items.slice(0, 7)).slice(0, 8);
  }, [items, q]);

  if (!open) return null;
  const pick = (i?: Item) => { if (!i) return; setOpen(false); i.run(); };
  return (
    <div className="fixed inset-0 z-[80] grid place-items-start justify-items-center bg-black/40 px-4 pt-[15vh]" onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-label="Command palette" className="w-full max-w-lg overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input ref={input} value={q} aria-label="Type a command" placeholder="Go to a page, vendor or invoice, or mark a bill paid"
            onChange={(e) => { setQ(e.target.value); setAt(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setAt((v) => Math.min(shown.length - 1, v + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAt((v) => Math.max(0, v - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); pick(shown[at]); }
            }}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </div>
        <ul role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches that.</li>}
          {shown.map((i, n) => (
            <li key={i.id} role="option" aria-selected={n === at}>
              <button type="button" onMouseEnter={() => setAt(n)} onClick={() => pick(i)}
                className={cn("flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm outline-none", n === at && "bg-muted")}>
                <i.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate">{i.label}</span>{i.hint && <span className="text-xs text-muted-foreground">{i.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
