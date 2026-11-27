"use client";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const KEY = "overbill:theme";
const listeners = new Set<() => void>();
const get = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, get, () => "dark");
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button variant="ghost" size="icon" className={className} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(KEY, next); } catch {}
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#020617" : "#f6f8fb");
        listeners.forEach((l) => l());
      }}>
      {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
