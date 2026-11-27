import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

const FOOTER = [["How it works", "/how-it-works"], ["Help", "/help"], ["Your data", "/data"], ["Privacy", "/privacy"], ["Terms", "/terms"]] as const;

export function SiteFooter() {
  return (
    <footer className="border-t px-5 py-8 text-sm text-muted-foreground">
      <nav aria-label="Footer" className="mx-auto flex max-w-2xl flex-wrap gap-x-6 gap-y-3">
        {FOOTER.map(([label, href]) => <Link key={href} href={href} className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-foreground">{label}</Link>)}
      </nav>
    </footer>
  );
}

/** Shared frame for the public pages: slim header, readable column, footer links. */
export function PageShell({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-foreground dark:bg-background [font-family:var(--font-display),system-ui,sans-serif]">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-5 py-5">
        <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="Overbill home">
          <svg viewBox="0 0 28 28" className="size-9" aria-hidden><rect width="28" height="28" rx="8" className="fill-green-700" /><circle cx="14" cy="14" r="6.5" fill="none" stroke="white" strokeWidth="3" /><path d="M17.5 5.5 22 10" stroke="white" strokeOpacity="0.65" strokeWidth="3" strokeLinecap="round" /></svg>
          <span className="text-xl font-semibold tracking-tight">Overbill</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <ThemeToggle className="size-11 rounded-full" />
          <Link href="/dashboard" className="inline-flex h-11 items-center rounded-full bg-green-700 px-4 text-sm font-semibold whitespace-nowrap text-white hover:bg-green-800">Open app</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pt-6 pb-16 sm:pt-12">
        <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
        {intro && <p className="mt-4 text-lg leading-relaxed text-muted-foreground sm:text-xl">{intro}</p>}
        <div className="mt-8 space-y-10 sm:mt-10">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-muted-foreground sm:text-lg [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{children}</div>
    </section>
  );
}
