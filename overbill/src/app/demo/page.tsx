"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { actions, getSnapshotState, hasOwnData } from "@/lib/data/store";

/**
 * Opens the dashboard with the fictional sample set. A link can send anyone here, so this page never replaces data the
 * person created: if they have any, it asks first. It reads the saved data directly, not the hook, because the hook
 * shows the sample set until the browser's saved data has loaded.
 */
export default function Demo() {
  const router = useRouter();
  const ran = useRef(false);
  const ask = useSyncExternalStore(
    (cb) => { window.addEventListener("storage", cb); return () => window.removeEventListener("storage", cb); },
    () => hasOwnData(getSnapshotState()),
    () => false,
  );

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (hasOwnData(getSnapshotState())) return; // the page re-renders with the question
    actions.resetDemo();
    router.replace("/dashboard");
  }, [router]);

  if (!ask) return <p role="status" className="grid min-h-screen place-items-center text-base text-muted-foreground">Loading sample data…</p>;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-5">
      <h1 className="text-2xl font-semibold tracking-tight">Replace your data with sample data?</h1>
      <p className="text-base text-muted-foreground">This browser holds your own invoices or recovery cases. Loading the sample set would replace them with fictional ones. Your profile and settings stay. Download a backup first if you want a copy.</p>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Link href="/dashboard" className="inline-flex h-12 items-center justify-center rounded-full border px-6 text-base font-semibold hover:bg-muted">Keep my data</Link>
        <Link href="/data" className="inline-flex h-12 items-center justify-center rounded-full border px-6 text-base font-semibold hover:bg-muted">Download a backup</Link>
        <Button variant="primary" className="h-12 px-6 text-base" onClick={() => { actions.resetDemo(); router.replace("/dashboard"); }}>Replace with sample data</Button>
      </div>
    </main>
  );
}
