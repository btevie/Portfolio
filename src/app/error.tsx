"use client";
import { localRepository } from "@/lib/data/repository";

/** Last line of defence: if stored data ever breaks the app, offer a way back without opening DevTools. */
export default function ErrorPage({ retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-lg px-6 py-20 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">Overbill hit an unexpected error. If it keeps happening, the data saved in this browser may be damaged. Clearing it restores the demo data (your saved invoices on this device will be lost).</p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={() => retry()} className="h-10 cursor-pointer rounded-md border border-line-strong bg-surface px-4 text-sm font-medium">Try again</button>
        <button type="button" onClick={() => { localRepository.clear(); window.location.reload(); }} className="h-10 cursor-pointer rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Clear saved data &amp; reload</button>
      </div>
    </div>
  );
}
