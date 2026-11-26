"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileImage, FileSpreadsheet, FileText, LoaderCircle, ShieldCheck, UploadCloud, X } from "lucide-react";
import { useAudited } from "@/lib/data/hooks";
import { effectiveClassification } from "@/lib/data/selectors";
import { actions, getSnapshotState, useAppState } from "@/lib/data/store";
import { buildInvoice } from "@/lib/extraction/build";
import { extractInvoice } from "@/lib/extraction";
import { SAMPLE_TEXT } from "@/lib/extraction/parsers";
import { MAX_FILES, MAX_FILE_BYTES, MAX_TEXT_CHARS, type ExtractedInvoice, type FieldKey } from "@/lib/extraction/types";
import { validateFile } from "@/lib/extraction/validate";
import { cn } from "@/lib/cn";
import { Button, Card, ClassBadge, Field, fieldClass, PageHeader, SectionHeader } from "@/components/ui";

type JobState = "ready" | "invalid" | "running" | "review" | "done" | "failed";
interface Job {
  id: string; name: string; size?: number; type?: string; file?: File; text?: string;
  state: JobState; progress: number; stage: string; error?: string; extracted?: ExtractedInvoice; invoiceId?: string;
}

const STAGES = [
  { at: 12, label: "Reading document" }, { at: 40, label: "Extracting fields" },
  { at: 70, label: "Running 8 checks" }, { at: 92, label: "Comparing with vendor history" },
];
const CHECKS = ["Arithmetic errors", "Duplicate charges", "Unexpected price increases", "Tax inconsistencies", "Contract/rate discrepancies", "Unusual fees"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kb = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

function Icon({ name, type }: { name: string; type?: string }) {
  if (name.toLowerCase().endsWith(".csv")) return <FileSpreadsheet className="size-5" aria-hidden />;
  if (type?.startsWith("image/")) return <FileImage className="size-5" aria-hidden />;
  return <FileText className="size-5" aria-hidden />;
}

export function UploadFlow() {
  const state = useAppState();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tab, setTab] = useState<"files" | "text">("files");
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const patch = useCallback((id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j))), []);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const room = MAX_FILES - jobs.length;
    if (incoming.length > room) setNotice(`You can check up to ${MAX_FILES} files at once; ${incoming.length - Math.max(room, 0)} were skipped.`); else setNotice("");
    const next: Job[] = incoming.slice(0, Math.max(room, 0)).map((f) => {
      const error = validateFile(f);
      return { id: crypto.randomUUID(), name: f.name, size: f.size, type: f.type, file: f, state: error ? "invalid" : "ready", progress: 0, stage: "", error: error ?? undefined };
    });
    setJobs((js) => [...js, ...next]);
  }

  function remove(id: string) { setJobs((js) => js.filter((j) => j.id !== id)); }

  /** Extract → (optional human review) → store. The original file is dropped from memory as soon as it's read. */
  async function process(job: Job, override?: ExtractedInvoice) {
    patch(job.id, { state: "running", error: undefined, progress: 4, stage: STAGES[0].label });
    try {
      let extracted = override;
      if (!extracted) {
        const fileText = job.file && job.name.toLowerCase().endsWith(".csv") ? await job.file.text() : undefined;
        for (const s of STAGES.slice(0, 2)) { patch(job.id, { progress: s.at, stage: s.label }); await sleep(350); }
        extracted = await extractInvoice(job.text !== undefined ? { kind: "text", text: job.text } : { kind: "file", name: job.name, type: job.type ?? "", size: job.size ?? 0, text: fileText }, { defaultCurrency: state.settings.currency });
        if (extracted.lowConfidence.length) { patch(job.id, { state: "review", progress: 45, stage: "Needs your confirmation", extracted, file: undefined }); return; }
      }
      for (const s of STAGES.slice(2)) { patch(job.id, { progress: s.at, stage: s.label }); await sleep(350); }
      const { invoice, newVendor } = buildInvoice(extracted, getSnapshotState());
      actions.addInvoices([invoice], newVendor ? [newVendor] : []);
      patch(job.id, { state: "done", progress: 100, stage: "Done", invoiceId: invoice.id, file: undefined, extracted: undefined });
    } catch (e) {
      patch(job.id, { state: "failed", progress: 0, stage: "", error: e instanceof Error ? e.message : "Something went wrong reading this invoice." });
    }
  }

  async function runAll() {
    setBusy(true);
    for (const j of jobs.filter((x) => x.state === "ready")) await process(j);
    setBusy(false);
  }

  function addText() {
    const t = text.trim();
    if (!t) return;
    if (t.length > MAX_TEXT_CHARS) { setNotice(`Pasted text is longer than ${MAX_TEXT_CHARS.toLocaleString()} characters.`); return; }
    const job: Job = { id: crypto.randomUUID(), name: "Pasted invoice text", text: t, state: "ready", progress: 0, stage: "" };
    setJobs((js) => [...js, job]);
    setText("");
    setBusy(true);
    process(job).finally(() => setBusy(false));
  }

  const ready = jobs.filter((j) => j.state === "ready");

  return (
    <>
      <PageHeader title="Check an invoice" description="Upload a bill before you pay it. We'll compare it with the vendor's history and flag anything that looks off." />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <div role="tablist" aria-label="Input method" className="inline-flex rounded-md border border-line bg-surface p-0.5">
            {([["files", "Upload files"], ["text", "Paste text"]] as const).map(([k, l]) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 cursor-pointer rounded px-3 text-[13px] font-medium transition-colors duration-150", tab === k ? "bg-primary text-white" : "text-muted hover:text-ink")}>{l}</button>
            ))}
          </div>

          {tab === "files" ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
              className={cn("rounded-lg border-2 border-dashed bg-surface px-6 py-10 text-center transition-colors duration-150", drag ? "border-primary bg-primary-soft" : "border-line-strong")}
            >
              <UploadCloud className="mx-auto size-8 text-primary" aria-hidden />
              <p className="mt-3 text-[15px] font-semibold">Drag invoices here</p>
              <p className="mt-1 text-sm text-muted">PDF, PNG, JPG, WebP or CSV · up to {MAX_FILES} files · {MAX_FILE_BYTES / 1024 / 1024} MB each</p>
              <input ref={input} id="file-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.csv" className="sr-only" aria-label="Choose invoice files" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
              <Button className="mt-4" variant="primary" onClick={() => input.current?.click()}>Choose files</Button>
            </div>
          ) : (
            <Card className="p-4">
              <label htmlFor="paste" className="mb-1.5 block text-[13px] font-medium">Paste invoice text</label>
              <textarea id="paste" value={text} onChange={(e) => setText(e.target.value)} rows={11} placeholder={"Vendor: …\nInvoice #: …\nInvoice date: 2026-11-25\nDue date: 2026-12-09\nDescription | quantity | unit price | total\nSubtotal: …\nTax: …\nTotal: …"} className="w-full rounded-md border border-line-strong p-3 font-mono text-[13px] leading-relaxed placeholder:text-subtle" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => setText(SAMPLE_TEXT)} className="cursor-pointer text-[13px] font-medium text-primary hover:underline">Insert a sample invoice</button>
                <Button variant="primary" disabled={!text.trim() || busy} onClick={addText}>Check pasted invoice</Button>
              </div>
            </Card>
          )}

          <p role="status" className="min-h-5 text-[13px] text-warn">{notice}</p>

          {jobs.length > 0 && (
            <Card>
              <SectionHeader title={`${jobs.length} item${jobs.length === 1 ? "" : "s"}`} description="Original files are discarded from memory as soon as they're read." />
              <ul className="divide-y divide-line">
                {jobs.map((j) => <JobRow key={j.id} job={j} busy={busy} onRemove={() => remove(j.id)} onConfirm={(e) => process(j, e)} />)}
              </ul>
              {ready.length > 0 && (
                <div className="flex justify-end border-t border-line p-4"><Button variant="primary" disabled={busy} onClick={runAll}>{busy ? <LoaderCircle className="ig-spin size-4" aria-hidden /> : null}Check {ready.length} invoice{ready.length === 1 ? "" : "s"}</Button></div>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">What we check</h2>
            <ul className="mt-3 space-y-2">{CHECKS.map((c) => <li key={c} className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-primary" aria-hidden />{c}</li>)}</ul>
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">Checks are deterministic calculations, not AI guesses. A finding is an <strong>anomaly</strong> until you confirm it.</p>
          </Card>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><ShieldCheck className="size-4 text-primary" aria-hidden />Privacy</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-muted">
              <li>Files are read in your browser and never uploaded or stored.</li>
              <li>Only extracted fields are kept, on this device.</li>
              <li>PDFs and images use a <strong>demo extractor</strong> (no OCR is configured): the file name picks a scripted example such as <code>price-increase.pdf</code>, <code>duplicate.pdf</code>, <code>math-error.pdf</code> or <code>new-fee.pdf</code>. CSV and pasted text are parsed for real.</li>
            </ul>
          </Card>
          <Card className="p-5 text-[13px] text-muted">
            <h2 className="mb-1 text-[15px] font-semibold text-ink">CSV format</h2>
            Header row with <code>description, quantity, unit_price</code>; optional <code>vendor, invoice_number, invoice_date, due_date, currency, tax_rate, tax, invoice_total, kind</code> (use <code>fee</code> for fee lines).
          </Card>
        </aside>
      </div>
    </>
  );
}

function ResultChip({ id }: { id: string }) {
  const { state, audits } = useAudited();
  const a = audits[id];
  if (!a) return null;
  const c = effectiveClassification(state, a);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ClassBadge value={c} size="sm" />
      <span className="text-[13px] text-muted">{a.findings.length ? `${a.findings.length} finding${a.findings.length === 1 ? "" : "s"}` : "No issues found"}</span>
      <Link href={`/invoices/${id}`} className="text-[13px] font-medium text-primary hover:underline">View analysis</Link>
    </div>
  );
}

function JobRow({ job, busy, onRemove, onConfirm }: { job: Job; busy: boolean; onRemove: () => void; onConfirm: (e: ExtractedInvoice) => void }) {
  return (
    <li className="px-5 py-4" data-state={job.state}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-muted"><Icon name={job.name} type={job.type} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium">{job.name} {job.size ? <span className="font-normal text-muted">· {kb(job.size)}</span> : null}</p>
            {job.state !== "running" && !(busy && job.state === "ready") && <button type="button" onClick={onRemove} aria-label={`Remove ${job.name}`} className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink"><X className="size-4" /></button>}
          </div>
          {job.state === "ready" && <p className="text-[13px] text-muted">Ready to check</p>}
          {(job.state === "invalid" || job.state === "failed") && <p role="alert" className="mt-1 flex items-start gap-1.5 text-[13px] text-bad"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{job.error}</p>}
          {(job.state === "running" || job.state === "review") && (
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-xs text-muted"><span aria-live="polite">{job.stage}…</span><span className="num">{job.progress}%</span></div>
              <div role="progressbar" aria-label={`Progress for ${job.name}`} aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${job.progress}%` }} /></div>
            </div>
          )}
          {job.state === "review" && job.extracted && <ReviewForm e={job.extracted} onConfirm={onConfirm} />}
          {job.state === "done" && job.invoiceId && <div className="mt-1.5"><ResultChip id={job.invoiceId} /></div>}
          {job.state === "done" && <p className="mt-1 text-xs text-subtle">Original file discarded · only extracted fields saved</p>}
        </div>
      </div>
    </li>
  );
}

function ReviewForm({ e, onConfirm }: { e: ExtractedInvoice; onConfirm: (e: ExtractedInvoice) => void }) {
  const [v, setV] = useState({ vendorName: e.vendorName, number: e.number, date: e.date, dueDate: e.dueDate, total: e.total });
  const flagged = (k: FieldKey) => e.lowConfidence.includes(k);
  const valid = v.vendorName.trim() && v.number.trim() && /^\d{4}-\d{2}-\d{2}$/.test(v.date) && /^\d{4}-\d{2}-\d{2}$/.test(v.dueDate) && /^\d+(\.\d+)?$/.test(v.total);
  const set = (k: keyof typeof v) => (ev: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: ev.target.value });
  return (
    <form className="mt-3 rounded-md border border-warn-line bg-warn-bg/40 p-4" onSubmit={(ev) => { ev.preventDefault(); if (valid) onConfirm({ ...e, ...v, lowConfidence: [] }); }}>
      <p className="mb-3 flex items-start gap-2 text-[13px] text-warn"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />Some invoice details couldn&apos;t be extracted confidently. Review the highlighted fields before running the audit.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendor" htmlFor="rv-vendor" flagged={flagged("vendorName")}><input id="rv-vendor" className={fieldClass} value={v.vendorName} onChange={set("vendorName")} /></Field>
        <Field label="Invoice number" htmlFor="rv-number" flagged={flagged("number")}><input id="rv-number" className={fieldClass} value={v.number} onChange={set("number")} /></Field>
        <Field label="Invoice date" htmlFor="rv-date" flagged={flagged("date")} hint="YYYY-MM-DD"><input id="rv-date" className={fieldClass} value={v.date} onChange={set("date")} placeholder="2026-11-25" /></Field>
        <Field label="Due date" htmlFor="rv-due" flagged={flagged("dueDate")} hint="YYYY-MM-DD"><input id="rv-due" className={fieldClass} value={v.dueDate} onChange={set("dueDate")} placeholder="2026-12-25" /></Field>
        <Field label={`Total (${e.currency})`} htmlFor="rv-total" flagged={flagged("total")}><input id="rv-total" inputMode="decimal" className={fieldClass} value={v.total} onChange={set("total")} /></Field>
      </div>
      <div className="mt-3 flex justify-end"><Button variant="primary" disabled={!valid} onClick={() => valid && onConfirm({ ...e, ...v, lowConfidence: [] })}>Confirm and run audit</Button></div>
    </form>
  );
}

