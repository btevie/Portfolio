"use client";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CalendarPlus, CheckCheck, Clock3, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeReminders } from "@/lib/data/selectors";
import { useAudited } from "@/lib/data/hooks";
import { buildIcs, upcomingDeadlines } from "@/lib/deadlines";
import { cn } from "@/lib/cn";

const READ_KEY = "overbill:notifications:read:v1";
const READ_EVENT = "overbill:notifications:read-change";
const MAX_READ_IDS = 12_000; // enough for the maximum saved invoices and recovery cases

function parseReadIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const stored: unknown = JSON.parse(raw);
    return Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string").slice(-MAX_READ_IDS) : [];
  } catch { return []; }
}

export function NotificationBell({ className }: { className?: string }) {
  const { state, audits } = useAudited();
  const [now, setNow] = useState<number | null>(null);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const reminders = useMemo(() => now === null ? [] : activeReminders(state, audits, now), [state, audits, now]);
  const readSet = useMemo(() => new Set(readIds), [readIds]);
  const unread = reminders.filter((n) => !readSet.has(n.id)).length;

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    // Read the clock and saved read-marks just after mount (a timer callback, not synchronously in the effect).
    const first = window.setTimeout(() => {
      refresh();
      try { setReadIds(parseReadIds(window.localStorage.getItem(READ_KEY))); }
      catch { /* Notifications still work when browser storage is unavailable. */ }
      setReady(true);
    }, 0);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === READ_KEY) setReadIds(parseReadIds(e.newValue)); };
    const onReadChange = (e: Event) => {
      const ids = (e as CustomEvent<unknown>).detail;
      if (Array.isArray(ids) && ids.every((x) => typeof x === "string")) setReadIds(ids.slice(-MAX_READ_IDS));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(READ_EVENT, onReadChange);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(READ_EVENT, onReadChange); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const persistRead = (ids: string[]) => {
    const next = [...new Set(ids)].slice(-MAX_READ_IDS);
    setReadIds(next);
    try { window.localStorage.setItem(READ_KEY, JSON.stringify(next)); } catch { /* The current tab still reflects the read state. */ }
    window.dispatchEvent(new CustomEvent(READ_EVENT, { detail: next }));
  };
  const markRead = (id: string) => persistRead([...readIds, id]);
  const markAllRead = () => persistRead(reminders.map((n) => n.id));
  const exportCalendar = () => {
    // Built on this device and handed to the OS calendar, which then delivers the reminders (no server, no push subscription).
    const url = URL.createObjectURL(new Blob([buildIcs(upcomingDeadlines(state, audits))], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "overbill-deadlines.ics" });
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const icon = (kind: string) => kind === "due" ? Clock3 : kind === "reply" ? MessageCircle : Bell;

  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
        className={cn("relative grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
        <Bell className="size-5" aria-hidden />
        {ready && unread > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-bad px-1 text-[10px] leading-none font-bold text-white ring-2 ring-background">{unread > 99 ? "99+" : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.section role="dialog" aria-label="Notifications" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.14 }}
            className="fixed inset-x-3 top-[4.75rem] z-50 max-h-[min(32rem,calc(100dvh-6rem))] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl sm:absolute sm:inset-x-auto sm:top-[calc(100%+0.6rem)] sm:right-0 sm:w-[22rem] sm:origin-top-right">
            <header className="flex items-center justify-between border-b px-4 py-3">
              <div><h2 className="text-sm font-semibold">Notifications</h2><p className="mt-0.5 text-xs text-muted-foreground">Reminders from your invoices and cases</p></div>
              {unread > 0 && <button type="button" onClick={markAllRead} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><CheckCheck className="size-4" aria-hidden />Mark all read</button>}
            </header>
            <div className="max-h-[min(26rem,calc(100dvh-11rem))] overflow-y-auto overscroll-contain">
              {reminders.length === 0 ? (
                <div className="px-5 py-10 text-center"><Bell className="mx-auto size-6 text-muted-foreground" aria-hidden /><p className="mt-2 text-sm font-medium">You&apos;re all caught up</p><p className="mt-1 text-xs text-muted-foreground">New reminders will show up here.</p></div>
              ) : (
                <ul aria-label="Current reminders" className="divide-y divide-line">
                  {reminders.map((n) => {
                    const Icon = icon(n.kind);
                    const isUnread = ready && !readSet.has(n.id);
                    return <li key={n.id}>
                      <Link href={n.href} onClick={() => { markRead(n.id); setOpen(false); }} className={cn("flex min-h-16 items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", isUnread && "bg-primary/5")}>
                        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", isUnread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}><Icon className="size-4" aria-hidden /></span>
                        <span className="min-w-0 flex-1 text-sm leading-snug">{n.text}</span>
                        {isUnread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                      </Link>
                    </li>;
                  })}
                </ul>
              )}
            </div>
            <footer className="border-t px-4 py-2">
              <button type="button" onClick={exportCalendar} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><CalendarPlus className="size-4" aria-hidden />Add deadlines to your calendar</button>
              <p className="px-2 text-[11px] text-muted-foreground">Your phone or Mac will remind you. Nothing is sent anywhere.</p>
            </footer>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
