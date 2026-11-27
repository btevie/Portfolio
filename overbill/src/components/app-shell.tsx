"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Celebration } from "@/components/celebration";
import { haptic } from "@/lib/celebrate";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopBar } from "@/components/top-bar";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";
import { FileText, LayoutDashboard, PiggyBank, Settings, ShieldCheck, Store, Upload, Wallet } from "lucide-react";
import { MotionConfig, motion } from "framer-motion";
import { actions, usePersistStatus, useAppState } from "@/lib/data/store";
import { cn } from "@/lib/cn";
import { Sidebar, SidebarFooter, SidebarHeader, SidebarItem, SidebarNav, SidebarSection, SidebarToggle, useSidebar } from "@/components/ui/sidebar";

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <rect width="28" height="28" rx="8" className="fill-primary" />
      <circle cx="14" cy="14" r="6.5" fill="none" className="stroke-primary-foreground" strokeWidth="3" />
      <path d="M17.5 5.5 22 10" className="stroke-primary-foreground" strokeOpacity="0.6" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const PUBLIC_PATHS = new Set(["/", "/log-in", "/sign-up", "/how-it-works", "/privacy", "/terms", "/data", "/help", "/demo"]);

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/vendors", label: "Vendors", icon: Store },
  { href: "/recovery", label: "Recovery", icon: PiggyBank },
  { href: "/pay-run", label: "Pay run", icon: Wallet },
];

function Brand() {
  const { collapsed } = useSidebar();
  return (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Overbill dashboard">
      <Mark className="size-7 shrink-0" />
      {!collapsed && <span className="truncate text-base font-semibold tracking-tight">Overbill</span>}
    </Link>
  );
}

function Privacy() {
  const { collapsed } = useSidebar();
  if (collapsed) return <ShieldCheck className="size-4 text-muted-foreground" aria-label="Your data stays in this browser" />;
  return (
    <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
      <span>Your data stays in this browser.</span>
    </p>
  );
}

function NavItems({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  const isActive = (href: string) => path === href || path.startsWith(href + "/");
  const { collapsed } = useSidebar();
  return (
    <>
      <div className="px-2 pb-2">
        <Link
          href="/invoices/new" onClick={onNavigate} title={collapsed ? "Check an invoice" : undefined}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Upload className="size-4 shrink-0" aria-hidden />
          {!collapsed && <span>Check an invoice</span>}
          {collapsed && <span className="sr-only">Check an invoice</span>}
        </Link>
      </div>
      <SidebarSection label="Workspace">
        {NAV.map(({ href, label, icon: Icon }) => (
          <SidebarItem key={href} asChild icon={<Icon className="size-[18px]" aria-hidden />} active={isActive(href)} label={label} onClick={onNavigate}>
            <Link href={href}>{label}</Link>
          </SidebarItem>
        ))}
      </SidebarSection>
      <SidebarSection label="Preferences">
        <SidebarItem asChild icon={<Settings className="size-[18px]" aria-hidden />} active={isActive("/settings")} label="Settings" onClick={onNavigate}>
          <Link href="/settings">Settings</Link>
        </SidebarItem>
      </SidebarSection>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const persist = usePersistStatus();
  const appState = useAppState();
  const profile = appState.user;
  const hasSample = appState.invoices.some((i) => i.source === "demo");
  const onSampleProfile = profile.id === "u-demo" && profile.email === "demo@overbill.example";
  // Animate route changes only; the first paint must stay visible in the server HTML (no opacity:0 flash).
  const [firstPath] = useState(path);
  useEffect(() => { document.documentElement.dataset.hydrated = "1"; }, []);

  if (PUBLIC_PATHS.has(path)) return <MotionConfig reducedMotion="user">{children}</MotionConfig>;

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen lg:flex">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow">Skip to content</a>

        {/* Desktop: collapsible 21st sidebar */}
        <div className="sticky top-0 hidden h-screen lg:block">
          <Sidebar aria-label="Primary" width={248}>
            <SidebarHeader><Brand /><span className="ml-auto flex items-center gap-1"><ThemeToggle /><SidebarToggle /></span></SidebarHeader>
            <SidebarNav><NavItems path={path} /></SidebarNav>
            <SidebarFooter><Privacy /></SidebarFooter>
          </Sidebar>
        </div>

        <div className="min-w-0 flex-1">
          <TopBar />
          {/* Mobile: top bar + sheet */}
          <div className="sticky top-0 z-30 flex h-16 items-center justify-between bg-background/90 px-5 backdrop-blur lg:hidden">
            <Link href="/dashboard" className="flex min-h-11 items-center gap-2.5"><Mark className="size-7" /><span className="text-base font-semibold tracking-tight">Overbill</span></Link>
            <div className="flex items-center"><ThemeToggle className="soft-pill size-10 rounded-full" /><div className="ml-1"><NotificationBell className="size-10" /></div>
              <div className="ml-2"><UserMenu size={40} /></div></div>
          </div>

          {hasSample && (
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b bg-muted/60 px-4 py-1.5 text-center text-xs text-muted-foreground" role="note" data-testid="demo-banner">
              <span><strong className="text-foreground">Demo data.</strong> <span className="max-sm:sr-only">All vendors and amounts are fictional.</span></span>
              <button type="button" onClick={() => actions.removeSample()} className="inline-flex min-h-10 cursor-pointer items-center rounded-full border px-4 text-xs font-semibold text-foreground hover:bg-muted">Remove sample data</button>
              {onSampleProfile && <Link href="/sign-up" className="inline-flex min-h-10 items-center rounded-full bg-green-700 px-4 text-xs font-semibold text-white hover:bg-green-800">Sign up to save your own</Link>}
            </div>
          )}
          {persist.saveFailed && <div role="alert" className="border-b border-bad-line bg-bad-bg px-4 py-2 text-center text-xs text-bad"><strong>Couldn&apos;t save to this browser</strong> (storage full or blocked). Recent changes will be lost when you close this tab. Export a copy from Settings to keep your data.</div>}
          {persist.dropped > 0 && <div role="status" className="border-b border-warn-line bg-warn-bg px-4 py-2 text-center text-xs text-warn">{persist.dropped} saved record{persist.dropped === 1 ? " was" : "s were"} invalid and skipped when loading.</div>}

          <main id="main" className="mx-auto w-full max-w-[1180px] px-5 pt-6 pb-28 sm:px-6 lg:px-10 lg:py-8">
            <motion.div
              key={path}
              // First paint: a CSS entrance (never leaves server HTML invisible). Later route changes: Framer.
              className={path === firstPath ? "animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both" : undefined}
              initial={path === firstPath ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            >
              {children}
            </motion.div>
          </main>

          <Celebration />
          <nav aria-label="Main" className="fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex items-center justify-between rounded-full bg-card/95 p-1.5 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35)] ring-1 ring-border backdrop-blur lg:hidden">
            {[NAV[0], NAV[1], { href: "/invoices/new", label: "Check", icon: Upload }, NAV[2], NAV[3]].map((n) => {
              const active = n.href === "/invoices/new" ? path === n.href : n.href === "/invoices" ? path.startsWith("/invoices") && path !== "/invoices/new" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} onClick={() => haptic(6)} aria-current={active ? "page" : undefined} className={cn("relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full transition-colors", active ? "text-white" : "text-muted-foreground active:bg-muted")}>
                  {active && <motion.span layoutId="bottom-pill" className="absolute inset-0 rounded-full bg-selected shadow-md" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                  <n.icon className="relative size-5" aria-hidden />
                  <span className="relative text-xs leading-none font-medium">{n.label === "Dashboard" ? "Home" : n.label}</span>
                </Link>
              );
            })}
          </nav>

        </div>
      </div>
    </MotionConfig>
  );
}
