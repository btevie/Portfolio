"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PartyPopper, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Celebration } from "@/lib/celebrate";

const rnd = (i: number) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const COLORS = ["#22c55e", "#4ade80", "#f59e0b", "#38bdf8", "#f8fafc"];

function Burst({ big }: { big: boolean }) {
  const parts = useMemo(() => Array.from({ length: big ? 36 : 16 }, (_, i) => {
    const a = (Math.PI * 2 * i) / (big ? 36 : 16) + rnd(i + 7) * 0.4;
    const d = (big ? 160 : 90) + rnd(i + 14) * (big ? 200 : 80);
    return { x: Math.cos(a) * d, y: Math.sin(a) * d - (big ? 60 : 20), r: rnd(i + 21) * 540 - 270, c: COLORS[i % COLORS.length], w: 6 + rnd(i + 28) * 6, h: 8 + rnd(i + 35) * 8 };
  }), [big]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] grid place-items-center">
      {parts.map((p, i) => (
        <motion.span key={i} className="absolute rounded-[2px]" style={{ background: p.c, width: p.w, height: p.h }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
          animate={{ x: p.x, y: [p.y, p.y + 140], opacity: [1, 1, 0], scale: 1, rotate: p.r }}
          transition={{ duration: big ? 1.3 : 0.9, ease: "easeOut" }} />
      ))}
    </div>
  );
}

export function Celebration() {
  const reduce = useReducedMotion();
  const [c, setC] = useState<(Celebration & { id: number }) | null>(null);
  useEffect(() => {
    let n = 0, t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      const d = (e as CustomEvent<Celebration>).detail;
      setC({ ...d, id: ++n });
      clearTimeout(t);
      t = setTimeout(() => setC(null), d.kind === "win" ? 2600 : 1800);
    };
    window.addEventListener("overbill:celebrate", on);
    return () => { window.removeEventListener("overbill:celebrate", on); clearTimeout(t); };
  }, []);
  return (
    <>
      {c && !reduce && c.kind !== "step" && <Burst key={c.id} big={c.kind === "win"} />}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex justify-center px-4 lg:top-6">
        <AnimatePresence>
          {c?.message && (
            <motion.p key={c.id} initial={{ opacity: 0, y: -16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ type: "spring", stiffness: 420, damping: 26 }}
              className="inline-flex items-center gap-2 rounded-full border border-ok-line bg-card px-4 py-2.5 text-sm font-semibold text-ok shadow-lg shadow-black/30">
              {c.kind === "win" ? <PartyPopper className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}{c.message}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
