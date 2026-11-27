"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LogIn, Lock, Mail, User, UserPlus } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

export type AuthField = { id: string; label: string; type?: string; autoComplete?: string; inputMode?: "email" | "text"; value: string; onChange: (v: string) => void; icon: "mail" | "user" | "lock" };

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z" /><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38l4-3.1z" /><path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.1C6.22 6.86 8.87 4.75 12 4.75z" /></svg>
);
const SPRING = { type: "spring", stiffness: 260, damping: 22 } as const;
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.25 } } };
const rise = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: SPRING } };

/**
 * Clean, minimal sign-in card (adapted from the 21st.dev "Clean Minimal Sign In").
 * Uses the app's theme tokens so it works in light and dark mode.
 */
export function CleanMinimalSignIn({ mode, avatar, title, subtitle, fields, error, notice, submitLabel, onSubmit, onForgot, onGoogle, altAction, footer }: {
  mode: "log-in" | "sign-up";
  /** Replaces the icon tile, for example with the person's picture or initials. */
  avatar?: ReactNode;
  title: string;
  subtitle: string;
  fields: AuthField[];
  error: string;
  notice?: string;
  submitLabel: string;
  onSubmit: (e: FormEvent) => void;
  onForgot: () => void;
  /** Only passed when Google sign-in is actually configured; no other providers are offered. */
  onGoogle?: () => void;
  altAction: ReactNode;
  footer: ReactNode;
}) {
  const Icon = mode === "log-in" ? LogIn : UserPlus;
  return (
    <motion.div initial={{ opacity: 0, y: 28, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING} className="w-full max-w-sm rounded-3xl border bg-card p-5 text-card-foreground shadow-xl shadow-black/5 sm:p-8">
      <AnimatePresence mode="wait" initial={false}>
        {avatar ? (
          <motion.div key="avatar" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={SPRING} className="mx-auto mb-5 flex w-fit sm:mb-6">{avatar}</motion.div>
        ) : (
          <motion.div key="icon" initial={{ opacity: 0, scale: 0.5, rotate: -14 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ ...SPRING, delay: 0.12 }} className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border bg-background shadow-sm sm:mb-6">
            <Icon className="size-7" aria-hidden />
          </motion.div>
        )}
      </AnimatePresence>
      <h1 className="mb-2 text-center text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mb-6 text-center text-sm text-muted-foreground">{subtitle}</p>

      <motion.form onSubmit={onSubmit} noValidate className="flex flex-col gap-3" variants={stagger} initial="hidden" animate="show">
        {fields.map((f) => {
          const FieldIcon = f.icon === "mail" ? Mail : f.icon === "lock" ? Lock : User;
          return (
            <motion.div key={f.id} variants={rise}>
              <label htmlFor={f.id} className="sr-only">{f.label}</label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"><FieldIcon className="size-4" aria-hidden /></span>
                <input id={f.id} placeholder={f.label} type={f.type ?? "text"} inputMode={f.inputMode} autoComplete={f.autoComplete} value={f.value} onChange={(e) => f.onChange(e.target.value)}
                  className="h-12 w-full rounded-xl border border-input bg-background pr-3 pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
            </motion.div>
          );
        })}
        {mode === "log-in" && <motion.div variants={rise} className="flex justify-end"><button type="button" onClick={onForgot} className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium hover:underline">Forgot password?</button></motion.div>}
        <AnimatePresence mode="wait" initial={false}>
          {error ? (
            <motion.p key={error} role="alert" initial={{ opacity: 0, x: 0 }} animate={{ opacity: 1, x: [0, -8, 8, -5, 5, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="text-sm font-medium text-bad">{error}</motion.p>
          ) : notice ? (
            <motion.p key={notice} role="status" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm text-muted-foreground">{notice}</motion.p>
          ) : null}
        </AnimatePresence>
        <motion.button variants={rise} whileTap={{ scale: 0.97 }} type="submit" className="mt-1 h-12 w-full cursor-pointer rounded-xl bg-green-700 text-base font-semibold text-white transition-colors hover:bg-green-800">{submitLabel}</motion.button>
      </motion.form>

      <motion.div variants={stagger} initial="hidden" animate="show">
      {onGoogle ? (
        <>
          <motion.div variants={rise} className="my-5 flex items-center gap-2">
            <div className="flex-grow border-t border-dashed" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-grow border-t border-dashed" />
          </motion.div>
          <motion.button variants={rise} type="button" whileTap={{ scale: 0.97 }} onClick={onGoogle} className="flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl border bg-background text-base font-medium transition-colors hover:bg-muted"><GoogleMark />{mode === "log-in" ? "Log in" : "Sign up"} with Google</motion.button>
        </>
      ) : <div className="h-5" />}
      <motion.div variants={rise} className="mt-3 grid gap-2">{altAction}</motion.div>
      <motion.div variants={rise} className="mt-4 text-center text-sm text-muted-foreground">{footer}</motion.div>
      </motion.div>
    </motion.div>
  );
}
