"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Database, FlaskConical, ImagePlus, UserRound, Settings } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ProfilePictureDialog } from "@/components/profile-picture-dialog";
import { Button, Modal } from "@/components/ui";
import { actions, hasOwnData, useAppState } from "@/lib/data/store";

/** Profile picture button at the top right. Opens a small menu: change picture, settings, your data, log out. */
export function UserMenu({ size = 40 }: { size?: number }) {
  const state = useAppState();
  const user = state.user;
  const [confirm, setConfirm] = useState(false);
  const hasOwnInvoices = hasOwnData(state);
  const hasSample = state.invoices.some((i) => i.source === "demo");
  const loadSample = () => { actions.resetDemo(); setConfirm(false); router.push("/dashboard"); };
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const item = "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-muted";
  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Your profile menu" onClick={() => setOpen((o) => !o)}
        className="relative grid cursor-pointer place-items-center rounded-full outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-ring" style={{ width: size, height: size }}>
        <Avatar name={user.name} email={user.email} picture={user.picture} size={size} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" aria-label="Your profile" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="absolute top-[calc(100%+0.5rem)] right-0 z-50 w-72 origin-top-right rounded-2xl border bg-popover p-2 text-popover-foreground shadow-xl">
            <div className="flex items-center gap-3 px-3 py-3">
              <Avatar name={user.name} email={user.email} picture={user.picture} size={44} />
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{user.name || "Your profile"}</p><p className="truncate text-xs text-muted-foreground">{user.email || "No email yet"}</p></div>
            </div>
            <div className="my-1 border-t" />
            <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); setDialog(true); }}><ImagePlus className="size-4 text-muted-foreground" aria-hidden />Change profile picture</button>
            <Link role="menuitem" href="/settings" className={item} onClick={() => setOpen(false)}><Settings className="size-4 text-muted-foreground" aria-hidden />Settings</Link>
            <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); if (hasSample) actions.removeSample(); else if (hasOwnInvoices) setConfirm(true); else loadSample(); }}><FlaskConical className="size-4 text-muted-foreground" aria-hidden />{hasSample ? "Remove sample data" : "Load sample data"}</button>
            <Link role="menuitem" href="/data" className={item} onClick={() => setOpen(false)}><Database className="size-4 text-muted-foreground" aria-hidden />Your data</Link>
            <div className="my-1 border-t" />
            <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); router.push("/log-in"); }}><UserRound className="size-4 text-muted-foreground" aria-hidden />Switch profile</button>
          </motion.div>
        )}
      </AnimatePresence>
      <ProfilePictureDialog open={dialog} onClose={() => setDialog(false)} />
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Replace your data with sample data?">
        <p className="text-sm text-muted-foreground">This swaps your invoices, vendors and recovery cases for the fictional sample set. Your profile and settings stay. Download a backup from Your data first if you want to keep what you have.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" onClick={loadSample}>Load sample data</Button></div>
      </Modal>
    </div>
  );
}
