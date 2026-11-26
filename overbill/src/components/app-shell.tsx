"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FileText, LayoutDashboard, Menu, PiggyBank, Settings, ShieldCheck, Store, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/vendors", label: "Vendors", icon: Store },
  { href: "/recovery", label: "Recovery", icon: PiggyBank },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => path === href || (href !== "/dashboard" && path.startsWith(href + "/")) || (href === "/invoices" && path.startsWith("/invoices"));

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href} href={href} onClick={() => setOpen(false)} aria-current={active(href) ? "page" : undefined}
          className={cn("flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150",
            active(href) ? "bg-primary-soft text-primary" : "text-muted hover:bg-canvas hover:text-ink")}
        >
          <Icon className="size-4" aria-hidden />{label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow">Skip to content</a>

      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <Link href="/dashboard" className="mb-5 flex items-center gap-2 px-3 text-[15px] font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-white"><ShieldCheck className="size-4" aria-hidden /></span>
          Overbill
        </Link>
        <Link href="/invoices/new" className={buttonClass("primary", "md", "mb-4 w-full")}><Upload className="size-4" aria-hidden />Check an invoice</Link>
        {nav}
        <p className="mt-auto px-3 text-xs leading-relaxed text-subtle">Your data stays in this browser. Overbill never contacts vendors, banks or payment services.</p>
      </aside>

      <div className="min-w-0">
        {/* mobile top bar */}
        <div className="sticky top-0 z-30 border-b border-line bg-surface lg:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <span className="grid size-7 place-items-center rounded-md bg-primary text-white"><ShieldCheck className="size-4" aria-hidden /></span>Overbill
            </Link>
            <button type="button" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)} className="cursor-pointer rounded-md p-2 hover:bg-canvas">
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
          {open && (
            <div id="mobile-nav" className="space-y-3 border-t border-line px-3 py-3">
              <Link href="/invoices/new" onClick={() => setOpen(false)} className={buttonClass("primary", "md", "w-full")}><Upload className="size-4" aria-hidden />Check an invoice</Link>
              {nav}
            </div>
          )}
        </div>

        <div className="border-b border-warn-line bg-warn-bg px-4 py-2 text-center text-xs text-warn" role="note">
          <strong>Demo data.</strong> Vendors, invoices and amounts here are fictional. Restore or clear them in Settings → Data.
        </div>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
