"use client";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Play } from "lucide-react";
import { PhoneMock } from "@/components/landing/phone";
import { ThemeToggle } from "@/components/theme-toggle";
import { Modal } from "@/components/ui";

const LINES = [["Catch", "the"], ["overcharge"], ["before", "you", "pay", "it."]];
const STEPS = ["Add your bill: upload a file or paste the text.", "Overbill checks it against that vendor's own history.", "You decide: pay it, or send a dispute note."];

function Swirl() {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 220 110" className="h-24 w-48 text-green-700 dark:text-green-500" fill="none" aria-hidden>
      <motion.path d="M8 88 C 40 96, 70 60, 52 44 C 38 32, 22 52, 44 62 C 90 82, 150 52, 204 22" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
        initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, delay: 1.1, ease: "easeInOut" }} />
      <motion.path d="M186 18 L206 21 L196 38" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.3 }} />
    </svg>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const [how, setHow] = useState(false);
  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-foreground dark:bg-background [font-family:var(--font-display),system-ui,sans-serif]">
      {/* Desktop: the colour panel sits on the right, with the hand and phone straddling its left edge */}
      <div aria-hidden className="absolute top-[30px] right-0 bottom-0 hidden w-[34%] rounded-t-[2.5rem] bg-[#1e4a36] lg:block">
      </div>
      <div className="absolute top-[30px] right-0 z-20 hidden w-[34%] items-center justify-end gap-3 px-8 pt-8 lg:flex">
        <ThemeToggle className="size-10 rounded-full text-white hover:bg-white/15 hover:text-white" />
        <Link href="/log-in" className="rounded-full border border-white/70 px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-white/10">Log in</Link>
        <Link href="/sign-up" className="rounded-full bg-white px-6 py-3 text-[15px] font-semibold text-green-900 transition-colors hover:bg-slate-100">Sign up</Link>
      </div>
      <PhoneMock variant="desktop" />

      <div className="relative z-10 flex flex-col px-5 lg:min-h-screen pt-5 pb-8 sm:px-10 lg:w-[58%] lg:px-14 lg:pt-8 lg:pb-0">
        <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-14">
          <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="Overbill home">
            <svg viewBox="0 0 28 28" className="size-9" aria-hidden><rect width="28" height="28" rx="8" className="fill-green-700" /><circle cx="14" cy="14" r="6.5" fill="none" stroke="white" strokeWidth="3" /><path d="M17.5 5.5 22 10" stroke="white" strokeOpacity="0.65" strokeWidth="3" strokeLinecap="round" /></svg>
            <span className="text-2xl font-semibold tracking-tight max-[359px]:hidden">Overbill</span>
          </Link>
          <nav aria-label="Site" className="hidden items-center gap-10 text-[17px] font-medium text-muted-foreground lg:flex">
            <a href="#top" className="hover:text-foreground">Home</a>
            <button type="button" onClick={() => setHow(true)} className="cursor-pointer hover:text-foreground">How it works</button>
            <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
          </nav>
          </div>
          <div className="flex items-center gap-1 lg:hidden"><ThemeToggle className="size-11 rounded-full" /><Link href="/log-in" className="inline-flex h-11 items-center rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap">Log in</Link><Link href="/sign-up" className="inline-flex h-11 items-center rounded-full bg-green-700 px-3.5 text-sm font-semibold whitespace-nowrap text-white">Sign up</Link></div>
        </motion.header>

        <div id="top" className="flex flex-col justify-center py-8 lg:flex-1 lg:pt-0 lg:pb-28">
          <div className="relative w-fit">
          <div aria-hidden className="pointer-events-none absolute top-1/2 left-[calc(66%+1.25rem)] z-10 hidden w-[11rem] -translate-y-[62%] -scale-x-100 lg:block"><Swirl /></div>
          <h1 className="text-[2.6rem] leading-[1.08] font-semibold tracking-tight sm:text-6xl xl:text-[4.25rem]">
            {LINES.map((line, li) => (
              <span key={li} className="block">
                {line.map((w, i) => (
                  <motion.span key={w + i} className={`mr-[0.25em] inline-block ${w === "overcharge" ? "text-green-700 dark:text-green-500" : ""}`}
                    initial={reduce ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + (li * 3 + i) * 0.08, type: "spring", stiffness: 140, damping: 18 }}>{w}</motion.span>
                ))}
              </span>
            ))}
          </h1>
          </div>
          <motion.p initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85 }} className="mt-5 max-w-[34ch] text-lg leading-relaxed text-muted-foreground sm:mt-6 sm:text-xl">
            Upload a bill and Overbill checks it against that vendor&apos;s history. Duplicates, price rises and maths errors show up in seconds.
          </motion.p>

          <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }} className="mt-7 grid gap-3 sm:mt-9 sm:flex sm:flex-wrap">
            <Link href="/invoices/new" className="group inline-flex h-14 items-center justify-center gap-2 rounded-full bg-green-700 px-7 text-base font-semibold text-white transition-colors hover:bg-green-800 active:scale-[0.97]">
              Check an invoice<ArrowRight className="size-5 transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
            <Link href="/demo" className="inline-flex h-12 items-center justify-center rounded-full px-4 text-base font-semibold text-green-700 hover:underline dark:text-green-500 sm:h-14">Try sample data</Link>
            <button type="button" onClick={() => setHow(true)} className="inline-flex h-14 cursor-pointer items-center justify-center gap-2 rounded-full border bg-card px-6 text-base font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.97]">
              <Play className="size-5" aria-hidden />How it works
            </button>
          </motion.div>
        </div>

        {/* Mobile: the same picture, in a card under the text */}
        <motion.div initial={reduce ? false : { opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="relative mt-4 h-[540px] overflow-hidden rounded-[2rem] bg-[#1e4a36] sm:h-[620px] lg:hidden">
          <PhoneMock variant="mobile" />
        </motion.div>

        <nav aria-label="Footer" className="mt-6 flex flex-wrap gap-x-5 text-sm text-muted-foreground lg:mt-0 lg:pb-6">
          {[["How it works", "/how-it-works"], ["Help", "/help"], ["Your data", "/data"], ["Privacy", "/privacy"], ["Terms", "/terms"]].map(([l, h]) => <Link key={h} href={h} className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-foreground">{l}</Link>)}
        </nav>
      </div>

      <Modal open={how} onClose={() => setHow(false)} title="How it works">
        <ol className="list-decimal space-y-3 pl-5 text-base">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
        <div className="mt-5 flex flex-wrap gap-3"><Link href="/invoices/new" className="inline-flex h-11 items-center gap-2 rounded-full bg-green-700 px-5 text-sm font-semibold text-white hover:bg-green-800">Check an invoice<ArrowRight className="size-4" aria-hidden /></Link><Link href="/how-it-works" className="inline-flex h-11 items-center rounded-full border px-5 text-sm font-semibold hover:bg-muted">Read the details</Link></div>
      </Modal>
    </div>
  );
}
