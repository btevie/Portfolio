"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";

const ease = [0.43, 0.13, 0.23, 0.96] as const;

const containerVariants: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease, delayChildren: 0.1, staggerChildren: 0.1 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease } },
};

const numberVariants: Variants = {
  hidden: (direction: number) => ({ opacity: 0, x: direction * 40, y: 15, rotate: direction * 5 }),
  visible: { opacity: 0.7, x: 0, y: 0, rotate: 0, transition: { duration: 0.8, ease } },
};

const ghostVariants: Variants = {
  hidden: { scale: 0.8, opacity: 0, y: 15, rotate: -5 },
  visible: { scale: 1, opacity: 1, y: 0, rotate: 0, transition: { duration: 0.6, ease } },
};

export function NotFound() {
  // Portal to <body>: the app shell's animated wrapper has a transform, which would trap a fixed overlay inside <main>.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto overscroll-contain bg-background px-6 py-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <motion.div className="text-center" variants={containerVariants} initial="hidden" animate="visible">
        <div className="mb-8 flex items-center justify-center gap-4 md:mb-12 md:gap-6">
          <motion.span className="select-none font-display text-[64px] leading-none font-bold text-foreground min-[400px]:text-[80px] md:text-[120px]" variants={numberVariants} custom={-1}>
            4
          </motion.span>
          <motion.div variants={ghostVariants}>
            <div className="ghost-float">
              <Image src="/ghost.png" alt="Ghost" width={120} height={120} sizes="(min-width: 768px) 120px, 80px" priority draggable={false} className="h-16 w-auto select-none object-contain min-[400px]:h-20 md:h-[120px]" />
            </div>
          </motion.div>
          <motion.span className="select-none font-display text-[64px] leading-none font-bold text-foreground min-[400px]:text-[80px] md:text-[120px]" variants={numberVariants} custom={1}>
            4
          </motion.span>
        </div>

        <motion.h1 className="mb-4 select-none font-display text-balance text-3xl font-bold text-foreground md:mb-6 md:text-5xl" variants={itemVariants}>
          Boo! Page missing!
        </motion.h1>

        <motion.p className="mb-8 select-none text-balance text-base text-muted-foreground sm:text-lg md:mb-12 md:text-xl" variants={itemVariants}>
          Whoops! This page must be a ghost - it&apos;s not here!
        </motion.p>

        <motion.div variants={itemVariants}>
          <Link href="/" className="inline-flex min-h-12 select-none items-center rounded-full bg-primary px-8 text-base font-medium text-primary-foreground transition-transform duration-200 hover:opacity-90 active:scale-95 sm:text-lg">
            Back to Overbill
          </Link>
        </motion.div>
      </motion.div>
    </div>,
    document.body,
  );
}
