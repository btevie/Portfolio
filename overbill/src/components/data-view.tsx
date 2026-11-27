"use client";
import { markBackedUp } from "@/lib/backup";
import { Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { actions, useAppState } from "@/lib/data/store";
import { parseStoredState } from "@/lib/data/validate-state";
import { forgetLocalFlags } from "@/lib/get-started";
import { Button, Modal } from "@/components/ui";

const MAX_BYTES = 10 * 1024 * 1024;

export function DataView() {
  const s = useAppState();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState<{ raw: string; invoices: number; vendors: number; cases: number; dropped: number } | null>(null);

  function backup() {
    const blob = new Blob([JSON.stringify({ ...s, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "overbill-backup.json"; a.click(); markBackedUp();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg({ ok: true, text: "Backup downloaded." });
  }

  async function restore(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_BYTES) { setMsg({ ok: false, text: "That file is too large to be an Overbill backup." }); return; }
    const raw = await f.text();
    const parsed = parseStoredState(raw);
    if (!parsed) setMsg({ ok: false, text: "That file is not an Overbill backup. Nothing was changed." });
    else { setMsg(null); setPending({ raw, invoices: parsed.state.invoices.length, vendors: parsed.state.vendors.length, cases: parsed.state.recovery.length, dropped: parsed.dropped }); }
    if (file.current) file.current.value = "";
  }

  const rows = [
    { icon: Download, title: "Download a backup", text: "One file with your invoices, vendors, recovery cases and settings.", action: <Button variant="primary" onClick={backup}>Download backup</Button> },
    { icon: Upload, title: "Restore from a backup", text: "Replaces what is here with the file you choose.", action: <Button onClick={() => file.current?.click()}>Choose backup file</Button> },
    { icon: RotateCcw, title: "Load sample data", text: "Fictional vendors and invoices, so you can look around.", action: <Button onClick={() => { actions.resetDemo(); setMsg({ ok: true, text: "Sample data loaded." }); }}>Load sample data</Button> },
    { icon: Trash2, title: "Erase everything", text: "Removes every invoice, vendor and case, and blanks your profile.", action: <Button variant="danger" onClick={() => setConfirm(true)}>Erase all data</Button> },
  ];

  return (
    <div className="space-y-4">
      <p className="text-base text-muted-foreground sm:text-lg">
        Right now: <strong className="text-foreground">{s.invoices.length}</strong> invoices, <strong className="text-foreground">{s.vendors.length}</strong> vendors and <strong className="text-foreground">{s.recovery.length}</strong> recovery cases. Saved details are not encrypted.
      </p>
      <input ref={file} type="file" accept="application/json,.json" aria-label="Choose backup file" className="sr-only" onChange={(e) => restore(e.target.files?.[0])} />
      <div className="divide-y rounded-2xl border">
        {rows.map((r) => (
          <div key={r.title} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3"><r.icon className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden /><div><p className="text-base font-semibold sm:text-lg">{r.title}</p><p className="text-base text-muted-foreground">{r.text}</p></div></div>
            <div className="[&_button]:w-full sm:[&_button]:w-auto">{r.action}</div>
          </div>
        ))}
      </div>
      <div role="status" aria-live="polite" className="min-h-6">{msg && <p className={msg.ok ? "text-base font-medium text-ok" : "text-base font-medium text-bad"}>{msg.text}</p>}</div>

      <Modal open={!!pending} onClose={() => setPending(null)} title="Replace your data with this backup?">
        {pending && <p className="text-sm text-muted-foreground">The backup holds {pending.invoices} invoices, {pending.vendors} vendors and {pending.cases} recovery cases{pending.dropped ? `, and ${pending.dropped} invalid or repeated record${pending.dropped === 1 ? "" : "s"} will be skipped` : ""}. It replaces what is here now. Download a backup of your current data first if you want to keep it.</p>}
        <div className="mt-5 grid gap-2 sm:flex sm:justify-end">
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button onClick={backup}>Download current data first</Button>
          <Button variant="primary" onClick={() => { if (!pending) return; const res = actions.restore(pending.raw); setMsg(res ? { ok: true, text: res.dropped ? `Backup restored. ${res.dropped} invalid or repeated record${res.dropped === 1 ? " was" : "s were"} skipped.` : "Backup restored." } : { ok: false, text: "That file is not an Overbill backup. Nothing was changed." }); setPending(null); }}>Replace my data</Button>
        </div>
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Erase all data?">
        <p className="text-sm text-muted-foreground">This permanently removes all invoices, vendors and recovery cases, and blanks your profile. Download a backup first if you want a copy.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={() => { actions.clearAll(); forgetLocalFlags(); setConfirm(false); setMsg({ ok: true, text: "All data erased." }); }}>Erase everything</Button></div>
      </Modal>
    </div>
  );
}
