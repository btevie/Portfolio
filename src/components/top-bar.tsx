"use client";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UserMenu } from "@/components/user-menu";
import { NotificationBell } from "@/components/notification-bell";

/** Desktop top bar: back and forward, a search box in the middle, and the profile picture at the far right. */
export function TopBar() {
  const router = useRouter();
  const box = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { if (!box.current || box.current.offsetParent === null) return; /* hidden on phones: leave the browser shortcut alone */ e.preventDefault(); box.current.focus(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const nav = "grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  return (
    <div className="sticky top-0 z-30 hidden h-14 items-center gap-3 border-b bg-background/90 px-6 backdrop-blur lg:flex">
      <button type="button" aria-label="Back" onClick={() => router.back()} className={nav}><ChevronLeft className="size-5" aria-hidden /></button>
      <button type="button" aria-label="Forward" onClick={() => router.forward()} className={nav}><ChevronRight className="size-5" aria-hidden /></button>
      <form role="search" className="mx-auto w-full max-w-xl" onSubmit={(e) => { e.preventDefault(); const t = q.trim(); router.push(t ? `/invoices?q=${encodeURIComponent(t)}` : "/invoices"); box.current?.blur(); }}>
        <label htmlFor="top-search" className="sr-only">Quick search</label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input ref={box} id="top-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoices, vendors or findings"
            className="h-10 w-full rounded-lg border border-input bg-card pr-14 pl-10 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
          <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">⌘ K</kbd>
        </div>
      </form>
      <NotificationBell />
      <UserMenu size={36} />
    </div>
  );
}
