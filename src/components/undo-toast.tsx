"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

type Undo = { label: string; restore: () => void };

/** A short-lived "Undo" bar for changes the person may regret. Shows the latest one only. */
export function UndoToast() {
  const [u, setU] = useState<(Undo & { id: number }) | null>(null);
  useEffect(() => {
    let n = 0, t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setU({ ...(e as CustomEvent<Undo>).detail, id: ++n });
      clearTimeout(t);
      t = setTimeout(() => setU(null), 6000);
    };
    window.addEventListener("overbill:undo", on);
    return () => { window.removeEventListener("overbill:undo", on); clearTimeout(t); };
  }, []);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex justify-center px-4 lg:bottom-6">
      <AnimatePresence>
        {u && (
          <motion.div key={u.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.16 }}
            className="pointer-events-auto flex items-center gap-3 rounded-full bg-foreground py-1.5 pr-1.5 pl-4 text-sm text-background shadow-lg">
            <span>{u.label}</span>
            <button type="button" onClick={() => { u.restore(); setU(null); }} className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full bg-background/15 px-3 text-xs font-semibold outline-none hover:bg-background/25 focus-visible:ring-2 focus-visible:ring-ring"><Undo2 className="size-3.5" aria-hidden />Undo</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
