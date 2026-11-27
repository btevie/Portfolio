"use client";
import { useEffect, useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { mirrorLoad } from "@/lib/data/idb-mirror";
import { actions } from "@/lib/data/store";
import { parseStoredState } from "@/lib/data/validate-state";
import { Button } from "@/components/ui";

const KEY = "overbill:v1";

/** If the browser dropped the main copy of your data but the IndexedDB copy survived, offer to bring it back. Never automatic. */
export function MirrorRestore() {
  const [saved, setSaved] = useState<{ json: string; invoices: number } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { if (window.localStorage.getItem(KEY)) return; } catch { return; }
      const json = await mirrorLoad();
      const parsed = json ? parseStoredState(json) : null;
      if (alive && json && parsed && parsed.state.invoices.some((i) => i.source !== "demo")) setSaved({ json, invoices: parsed.state.invoices.length });
    })();
    return () => { alive = false; };
  }, []);
  if (!saved) return null;
  return (
    <div role="alert" className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-start gap-3 rounded-2xl bg-card p-4 shadow-lg ring-1 ring-border lg:bottom-6">
      <DatabaseBackup className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Your saved invoices were found</p>
        <p className="mt-0.5 text-muted-foreground">This browser cleared the main copy of your data, but a backup copy with {saved.invoices} invoice{saved.invoices === 1 ? "" : "s"} is still here.</p>
        <div className="mt-3 flex gap-2"><Button variant="primary" size="sm" onClick={() => { actions.restore(saved.json); setSaved(null); }}>Restore it</Button><Button size="sm" onClick={() => setSaved(null)}>Not now</Button></div>
      </div>
    </div>
  );
}
