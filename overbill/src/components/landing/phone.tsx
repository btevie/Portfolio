"use client";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import Image from "next/image";
import { ArrowUpRight, Check } from "lucide-react";
import { useEffect, useState } from "react";

/** A phone drawn in code, in a hand, showing Overbill's real first screen. Tilts toward the pointer. */
export function PhoneMock({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = [setTimeout(() => setStep(1), 1400), setTimeout(() => setStep(2), 4200), setTimeout(() => setStep(3), 4800), setTimeout(() => setStep(4), 7600)];
    return () => t.forEach(clearTimeout);
  }, [reduce]);
  const mx = useMotionValue(0), my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 120, damping: 18 }), sy = useSpring(my, { stiffness: 120, damping: 18 });
  const rotY = useTransform(sx, [-1, 1], [-8, 8]), rotX = useTransform(sy, [-1, 1], [6, -6]);

  return (
    <div className={variant === "desktop" ? "absolute top-[calc(51%-25vw)] right-[10vw] z-10 hidden w-[48vw] lg:block" : "absolute right-[-58px] -bottom-6 w-[410px] sm:right-0 sm:w-[470px] lg:hidden"} style={{ perspective: 1200 }}
      onPointerMove={(e) => { if (reduce) return; const r = e.currentTarget.getBoundingClientRect(); mx.set(((e.clientX - r.left) / r.width) * 2 - 1); my.set(((e.clientY - r.top) / r.height) * 2 - 1); }}
      onPointerLeave={() => { mx.set(0); my.set(0); }}>
      <motion.div style={{ rotateX: rotX, rotateY: rotY, transformStyle: "preserve-3d" }}
        initial={{ opacity: 0, y: 60, rotate: 9 }} animate={{ opacity: 1, y: 0, rotate: 5 }} transition={{ type: "spring", stiffness: 90, damping: 16, delay: 0.25 }}>
        <motion.div animate={reduce ? undefined : { y: [0, -7, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          className="relative aspect-[3/4] w-full">
          {/* A crisp phone, drawn in code, sits behind the photographed hand so the fingers wrap in front of it */}
          <div className="absolute" style={{ left: "28%", top: "14.2%", width: "35.5%", height: "50.5%" }}>
            {/* side buttons */}
            <span aria-hidden className="absolute top-[14%] -left-[1.1%] h-[4%] w-[1.6%] rounded-l-sm bg-[#8b9099]" />
            <span aria-hidden className="absolute top-[21%] -left-[1.1%] h-[7.5%] w-[1.6%] rounded-l-sm bg-[#8b9099]" />
            <span aria-hidden className="absolute top-[30%] -left-[1.1%] h-[7.5%] w-[1.6%] rounded-l-sm bg-[#8b9099]" />
            <span aria-hidden className="absolute top-[24%] -right-[1.1%] h-[11%] w-[1.6%] rounded-r-sm bg-[#8b9099]" />
            {/* titanium frame */}
            <div className="absolute inset-0 shadow-[0_14px_30px_-12px_rgba(0,0,0,0.5)]" style={{ borderRadius: "12% / 6%", background: "linear-gradient(145deg,#6b7078 0%,#2c2f35 35%,#4a4e56 65%,#1d1f23 100%)" }}>
              {/* black bezel */}
              <div className="absolute bg-black" style={{ inset: "0.45% 0.9%", borderRadius: "11.5% / 5.7%" }}>
                {/* screen */}
                <div className="absolute overflow-hidden bg-[#edf0f7]" style={{ inset: "0.9% 2%", borderRadius: "10.5% / 5.2%" }}>
                  <div className="absolute inset-x-0 top-0 z-10 flex h-[5.2%] items-center justify-between px-[9%] text-[0.5rem] font-semibold text-slate-900 sm:text-[0.55rem]">
                    <span>9:41</span>
                    <span className="flex items-center gap-[3px]" aria-hidden>
                      <svg viewBox="0 0 18 12" className="h-[0.5rem]" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="0.8" /><rect x="5" y="5" width="3" height="7" rx="0.8" /><rect x="10" y="2.5" width="3" height="9.5" rx="0.8" /><rect x="15" y="0" width="3" height="12" rx="0.8" /></svg>
                      <svg viewBox="0 0 24 12" className="h-[0.5rem]" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="0.6" y="0.6" width="20" height="10.8" rx="3" /><rect x="2.4" y="2.4" width="14" height="7.2" rx="1.6" fill="currentColor" stroke="none" /><rect x="21.5" y="4" width="1.8" height="4" rx="0.9" fill="currentColor" stroke="none" /></svg>
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized, lossless files: sharper than the on-the-fly optimiser */}
                  <img src="/screens/dashboard-960.png" srcSet="/screens/dashboard-640.png 640w, /screens/dashboard-960.png 960w, /screens/dashboard-1280.png 1280w" sizes="(min-width:1024px) 260px, 220px" width={1280} height={2389} alt="The Overbill dashboard: the invoice to review first, key figures and spending" decoding="async" fetchPriority={variant === "desktop" ? "high" : "auto"} className="absolute inset-x-0 top-[5.2%] h-[94.8%] w-full object-cover object-top" />
                  <span aria-hidden className="absolute top-[1.4%] left-1/2 z-20 h-[3%] w-[30%] -translate-x-1/2 rounded-full bg-black" />
                  <span aria-hidden className="absolute bottom-[1.2%] left-1/2 z-20 h-[0.6%] w-[34%] -translate-x-1/2 rounded-full bg-slate-900" />
                </div>
              </div>
            </div>
          </div>
          <Image src="/screens/hand.png" alt="A hand holding a phone" width={1536} height={2048} quality={95} priority sizes="(min-width:1024px) 560px, 500px" className="pointer-events-none absolute inset-0 h-full w-full" />
        </motion.div>
      </motion.div>

      {/* Popups: each one appears, says its piece, then goes away for good */}
      <AnimatePresence>
        {step === 1 && (
          <motion.div key="dup" className="absolute top-[26%] left-[1%] z-10 hidden sm:block" initial={{ opacity: 0, x: -24, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -16, scale: 0.95 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}>
            <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-slate-900 shadow-lg">
              <span className="grid size-7 place-items-center rounded-full bg-green-100 text-green-700"><Check className="size-4" /></span>
              <div className="leading-tight"><p className="text-xs font-semibold">Duplicate caught</p><p className="text-[10px] text-slate-500">before you paid it</p></div>
            </div>
          </motion.div>
        )}
        {step === 3 && (
          <motion.div key="back" className="absolute top-[52%] left-[0%] z-10 hidden sm:block" initial={{ opacity: 0, x: 24, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 16, scale: 0.95 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}>
            <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-slate-900 shadow-lg">
              <span className="grid size-7 place-items-center rounded-full bg-slate-100 text-slate-700"><ArrowUpRight className="size-4" /></span>
              <div className="leading-tight"><p className="text-xs font-semibold tabular-nums">€192.40 back</p><p className="text-[10px] text-slate-500">example, recovered so far</p></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
