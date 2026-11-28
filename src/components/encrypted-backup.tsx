"use client";
import { useRef, useState } from "react";
import { Download, LockKeyhole, Upload } from "lucide-react";
import { markBackedUp } from "@/lib/backup";
import { actions } from "@/lib/data/store";
import { parseStoredState } from "@/lib/data/validate-state";
import { decryptBackup, encryptBackup, MIN_PASSPHRASE } from "@/lib/vault";
import type { AppState } from "@/lib/types";
import { Button, fieldClass } from "@/components/ui";

/** Passphrase-protected backup and restore. Encryption happens in this browser; Overbill cannot recover a forgotten passphrase. */
export function EncryptedBackup({ state }: { state: AppState }) {
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ json: string; invoices: number; cases: number; dropped: number } | null>(null); // decrypted, waiting for the person to confirm
  const file = useRef<HTMLInputElement>(null);
  const gen = useRef(0); // only the latest restore may stage a backup

  async function download() {
    setBusy(true); setMsg(null);
    try {
      const sealed = await encryptBackup(JSON.stringify({ ...state, exportedAt: new Date().toISOString() }), pass);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([sealed], { type: "application/json" }));
      a.download = "overbill-backup.encrypted.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      markBackedUp();
      setMsg({ ok: true, text: "Encrypted backup downloaded. Keep the passphrase safe: it can't be recovered." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't create the backup." }); }
    setBusy(false);
  }

  async function restore(f: File | undefined) {
    if (!f) return;
    const mine = ++gen.current;
    setBusy(true); setMsg(null); setPending(null); // a backup staged earlier must not stay confirmable while another one opens or after it fails
    try {
      const json = await decryptBackup(await f.text(), pass);
      const parsed = parseStoredState(json);
      if (mine !== gen.current) return;
      if (parsed) setPending({ json, invoices: parsed.state.invoices.length, cases: parsed.state.recovery.length, dropped: parsed.dropped });
      else setMsg({ ok: false, text: "That backup didn't contain valid Overbill data. Nothing was changed." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't open the backup." }); }
    if (file.current) file.current.value = "";
    setBusy(false);
  }

  function confirmRestore() {
    if (!pending) return;
    const r = actions.restore(pending.json);
    setPending(null);
    setMsg(r ? { ok: true, text: `Restored${r.dropped ? ` (${r.dropped} invalid records skipped)` : ""}.` } : { ok: false, text: "That backup didn't contain valid Overbill data. Nothing was changed." });
  }

  return (
    <div className="p-4">
      <div className="flex items-start gap-3">
        <LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Encrypted backup</p>
          <p className="text-sm text-muted-foreground">Seal your data with a passphrase before you save it anywhere. It is encrypted in this browser. If you forget the passphrase, nobody can open the file, including us.</p>
          <label htmlFor="vault-pass" className="mt-3 mb-1.5 block text-sm font-medium">Passphrase <span className="font-normal text-muted-foreground">(at least {MIN_PASSPHRASE} characters)</span></label>
          <input id="vault-pass" type="password" autoComplete="new-password" className={`${fieldClass} max-w-sm`} value={pass} onChange={(e) => setPass(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={download} disabled={busy || pass.length < MIN_PASSPHRASE}><Download className="size-4" aria-hidden />Download encrypted backup</Button>
            <Button onClick={() => file.current?.click()} disabled={busy || !pass}><Upload className="size-4" aria-hidden />Restore from encrypted backup</Button>
            <input ref={file} type="file" accept=".json,application/json" aria-label="Choose encrypted backup file" disabled={busy} className="sr-only" onChange={(e) => restore(e.target.files?.[0])} />
          </div>
          {pending && (
            <div role="alert" className="mt-3 rounded-xl border p-3 text-sm">
              <p>This backup holds {pending.invoices} invoice{pending.invoices === 1 ? "" : "s"} and {pending.cases} recovery case{pending.cases === 1 ? "" : "s"}{pending.dropped ? ` (${pending.dropped} invalid records will be skipped)` : ""}. Restoring replaces everything currently here. Download a backup first if you may need it.</p>
              <div className="mt-2 flex gap-2"><Button onClick={() => setPending(null)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={confirmRestore}>Replace my data</Button></div>
            </div>
          )}
          {msg && <p role="status" className={msg.ok ? "mt-2 text-sm text-ok" : "mt-2 text-sm text-bad"}>{msg.text}</p>}
        </div>
      </div>
    </div>
  );
}
