"use client";
import { useEffect, useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { mirrorLoad } from "@/lib/data/idb-mirror";
import { actions, getSnapshotState, hasOwnData, useAppState } from "@/lib/data/store";
import { parseStoredState } from "@/lib/data/validate-state";
import { Button } from "@/components/ui";

const KEY = "overbill:v1";

/** True when the main copy holds data the person made. A main copy that is only the sample set or default settings (written by any early action) does not count as newer data. */
function mainCopyHasPersonalData(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = parseStoredState(raw);
    return parsed ? hasOwnData(parsed.state) : true; // unreadable but present: never offer to replace it
  } catch { return true; } // storage unavailable: do not offer to replace anything
}

/** If the browser dropped the main copy of your data but the IndexedDB copy survived, offer to bring it back. Never automatic. */
export function MirrorRestore() {
  const [saved, setSaved] = useState<{ json: string; invoices: number } | null>(null);
  const hasData = hasOwnData(useAppState()); // data added or restored since the offer appeared makes it stale
  useEffect(() => {
    let alive = true;
    (async () => {
      if (mainCopyHasPersonalData()) return;
      const json = await mirrorLoad();
      const parsed = json ? parseStoredState(json) : null;
      if (mainCopyHasPersonalData()) return; // personal data may have been written while the backup copy loaded
      if (alive && json && parsed && hasOwnData(parsed.state)) setSaved({ json, invoices: parsed.state.invoices.length });
    })();
    return () => { alive = false; };
  }, []);
  if (!saved || hasData) return null;
  return (
    <div role="alert" className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-start gap-3 rounded-2xl bg-card p-4 shadow-lg ring-1 ring-border lg:bottom-6">
      <DatabaseBackup className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Your saved invoices were found</p>
        <p className="mt-0.5 text-muted-foreground">This browser cleared the main copy of your data, but a backup copy with {saved.invoices} invoice{saved.invoices === 1 ? "" : "s"} is still here.</p>
        <div className="mt-3 flex gap-2"><Button variant="primary" size="sm" onClick={() => {
          // Check again: if new data was saved since the offer appeared, restoring would silently replace it.
          if (!hasOwnData(getSnapshotState()) && !mainCopyHasPersonalData()) actions.restore(saved.json);
          setSaved(null);
        }}>Restore it</Button><Button size="sm" onClick={() => setSaved(null)}>Not now</Button></div>
      </div>
    </div>
  );
}
