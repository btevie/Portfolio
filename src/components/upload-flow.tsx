"use client";
import { celebrate } from "@/lib/celebrate";
import Link from "next/link";
import { useCallback, useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, FileImage, FileSpreadsheet, FileText, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useAudited } from "@/lib/data/hooks";
import { effectiveClassification } from "@/lib/data/selectors";
import { isValidDecimal } from "@/lib/audit/money";
import { parseISO } from "@/lib/audit/normalize";
import { CURRENCIES, currencyName, isCurrency } from "@/lib/currencies";
import { actions, getSnapshotState, useAppState } from "@/lib/data/store";
import { buildInvoice } from "@/lib/extraction/build";
import { extractInvoice } from "@/lib/extraction";
import { CSV_TEMPLATE, SAMPLE_TEXT } from "@/lib/extraction/parsers";
import { MAX_FILES, MAX_FILE_BYTES, MAX_TEXT_CHARS, type ExtractedInvoice, type FieldKey } from "@/lib/extraction/types";
import { sniffFile, validateFile } from "@/lib/extraction/validate";
import { newId } from "@/lib/ids";
import { Button, Card, ClassBadge, Field, fieldClass, PageHeader, Pill, SectionHeader } from "@/components/ui";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SelectMenu } from "@/components/ui/select-menu";

type JobState = "ready" | "invalid" | "running" | "review" | "done" | "failed";
interface Job {
  id: string; name: string; size?: number; type?: string; file?: File; text?: string;
  state: JobState; progress: number; stage: string; error?: string; extracted?: ExtractedInvoice; invoiceId?: string;
}

const STAGES = [
  { at: 12, label: "Reading document" }, { at: 40, label: "Extracting fields" },
  { at: 70, label: "Running 8 checks" }, { at: 92, label: "Comparing with vendor history" },
];
const CHECKS = ["Arithmetic errors", "Tax", "Duplicate invoices", "Duplicate line items", "Dates and payment terms", "Price history", "Contract rates", "Unexpected fees"];
function downloadCsvTemplate() {
  const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = "overbill-invoice-template.csv";
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
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
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = useCallback((id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j))), []);

  async function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const room = MAX_FILES - jobs.length;
    if (incoming.length > room) setNotice(`You can check up to ${MAX_FILES} files at once; ${incoming.length - Math.max(room, 0)} were skipped.`); else setNotice("");
    // Cheap checks on the browser-reported name/type/size first, then the file's real leading bytes.
    const next: Job[] = await Promise.all(incoming.slice(0, Math.max(room, 0)).map(async (f) => {
      const error = validateFile(f) ?? (await sniffFile(f));
      return { id: newId(), name: f.name, size: f.size, type: f.type, file: f, state: error ? "invalid" : "ready", progress: 0, stage: "", error: error ?? undefined } as Job;
    }));
    setJobs((js) => [...js, ...next]);
  }

  function remove(id: string) { setJobs((js) => js.filter((j) => j.id !== id)); }

  /** Extract → (optional human review) → store. The File reference is dropped as soon as processing finishes or needs review. */
  async function process(job: Job, override?: ExtractedInvoice) {
    patch(job.id, { state: "running", error: undefined, progress: 4, stage: STAGES[0].label });
    try {
      let extracted = override;
      if (!extracted) {
        const fileText = job.file && job.name.toLowerCase().endsWith(".csv") ? await job.file.text() : undefined;
        const fileData = job.file && job.name.toLowerCase().endsWith(".pdf") ? await job.file.arrayBuffer() : undefined;
        for (const s of STAGES.slice(0, 2)) { patch(job.id, { progress: s.at, stage: s.label }); await sleep(350); }
        extracted = await extractInvoice(job.text !== undefined ? { kind: "text", text: job.text } : { kind: "file", name: job.name, type: job.type ?? "", size: job.size ?? 0, text: fileText, data: fileData }, { defaultCurrency: state.settings.currency });
        if (extracted.lowConfidence.length) { patch(job.id, { state: "review", progress: 45, stage: "Needs your confirmation", extracted, file: undefined }); return; }
      }
      for (const s of STAGES.slice(2)) { patch(job.id, { progress: s.at, stage: s.label }); await sleep(350); }
      const { invoice, newVendor } = buildInvoice(extracted, getSnapshotState());
      actions.addInvoices([invoice], newVendor ? [newVendor] : []);
      patch(job.id, { state: "done", progress: 100, stage: "Done", invoiceId: invoice.id, file: undefined, extracted: undefined });
    } catch (e) {
      patch(job.id, { state: "failed", progress: 0, stage: "", file: undefined, error: e instanceof Error ? e.message : "Something went wrong reading this invoice." });
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
    const job: Job = { id: newId(), name: "Pasted invoice text", text: t, state: "ready", progress: 0, stage: "" };
    setJobs((js) => [...js, job]);
    setText("");
    setBusy(true);
    process(job).finally(() => setBusy(false));
  }

  const ready = jobs.filter((j) => j.state === "ready");

  return (
    <>
      <PageHeader title="Check an invoice" description="Upload or paste a bill to check it against your history." />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <ol aria-label="How it works" className="hidden grid-cols-3 gap-2 sm:grid">
            {["Add your bill", "We check it against your history", "See what we found"].map((s, n) => (
              <motion.li key={s} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.08 * n, ease: [0.23, 1, 0.32, 1] }}
                className="flex flex-col items-start gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-xs sm:flex-row sm:items-center sm:gap-2.5 sm:text-sm">
                <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{n + 1}</span>{s}
              </motion.li>
            ))}
          </ol>
          <Tabs value={tab} onValueChange={(v) => setTab(v as "files" | "text")}>
            <TabsList aria-label="Input method">
              <TabsTrigger value="files">Upload files</TabsTrigger>
              <TabsTrigger value="text">Paste text</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "files" ? (
            <>
              <FileDropzone
                onFiles={addFiles} accept=".pdf,.png,.jpg,.jpeg,.webp,.csv" inputLabel="Choose invoice files" label="Drag invoices here"
                hint={`PDF (with text), PNG, JPG, WebP or CSV · up to ${MAX_FILES} files · ${MAX_FILE_BYTES / 1024 / 1024} MB each`}
              />
              <p role="note" className="text-xs leading-relaxed text-muted-foreground">CSV, pasted text and text PDFs are read for real. Photos and scans use a clearly labelled demo example; they are not read. <a className="font-medium text-foreground underline underline-offset-2" href="#privacy-demo-limits">Privacy &amp; demo limits</a></p>
            </>
          ) : (
            <Card className="p-4">
              <label htmlFor="paste" className="mb-1.5 block text-sm font-medium">Paste invoice text</label>
              <Textarea id="paste" value={text} onChange={(e) => setText(e.target.value)} rows={11} placeholder={"Vendor: …\nInvoice #: …\nInvoice date: 2026-11-25\nDue date: 2026-12-09\nDescription | quantity | unit price | total\nSubtotal: …\nTax: …\nTotal: …"} className="font-mono text-sm leading-relaxed" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={downloadCsvTemplate} className="mr-4 cursor-pointer text-sm font-medium text-primary hover:underline">Download CSV template</button><button type="button" onClick={() => setText(SAMPLE_TEXT)} className="cursor-pointer text-sm font-medium text-primary hover:underline">Insert a sample invoice</button>
                <Button variant="primary" disabled={!text.trim() || busy} onClick={addText}>Check pasted invoice</Button>
              </div>
            </Card>
          )}

          <p role="status" className="min-h-5 text-sm text-warn">{notice}</p>

          {jobs.length > 0 && (
            <Card>
              <SectionHeader title={`${jobs.length} item${jobs.length === 1 ? "" : "s"}`} description="Files are never uploaded." />
              <ul className="divide-y divide-line">
                <AnimatePresence initial={false}>{jobs.map((j) => <JobRow key={j.id} job={j} busy={busy} onRemove={() => remove(j.id)} onConfirm={(e) => process(j, e)} />)}</AnimatePresence>
              </ul>
              {ready.length > 0 && (
                <div className="flex justify-end border-t border-line p-4"><Button variant="primary" disabled={busy} onClick={runAll}>{busy ? <LoaderCircle className="ig-spin size-4" aria-hidden /> : null}Check {ready.length} invoice{ready.length === 1 ? "" : "s"}</Button></div>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-3 sm:space-y-4">
          <Card className="hidden p-5 lg:block">
            <h2 className="display text-base font-semibold">What we check</h2>
            <ul className="mt-3 space-y-2">{CHECKS.map((c) => <li key={c} className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-primary" aria-hidden />{c}</li>)}</ul>
          </Card>
          <Card className="p-4 sm:p-5">
            <h2 id="privacy-demo-limits" className="display flex items-center gap-2 text-base font-semibold"><ShieldCheck className="size-4 text-primary" aria-hidden />Privacy &amp; demo limits</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground"><li>Files are never saved. CSV and PDF text are read in your browser.</li><li>Extracted fields are stored <strong>unencrypted</strong> in this browser.</li><li>PDFs with selectable text are read in your browser. Photos and scanned PDFs use a <strong>demo extractor</strong>: the file name picks an example such as <code>duplicate.pdf</code> or <code>new-fee.pdf</code>.</li></ul>
          </Card>
          <Card className="p-5 text-sm text-muted-foreground max-sm:hidden">
            <h2 className="display mb-1 text-base font-semibold text-ink">CSV format</h2>
            <button type="button" onClick={downloadCsvTemplate} className="mb-2 inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary hover:underline">Download a CSV template</button>
            <p>Header row with <code>description, quantity, unit_price</code>; optional <code>vendor, invoice_number, invoice_date, due_date, currency, tax_rate, tax, invoice_total, kind</code> (use <code>fee</code> for fee lines).</p>
          </Card>
        </aside>
      </div>
    </>
  );
}

function ResultChip({ id }: { id: string }) {
  const { state, audits } = useAudited();
  const a = audits[id];
  const c = a ? effectiveClassification(state, a) : null;
  const invoice = state.invoices.find((i) => i.id === id);
  useEffect(() => { if (c === "CLEAR" && !invoice?.isCredit) celebrate({ kind: "clear", message: "Done. Nothing flagged (not a guarantee)" }); }, [c, invoice?.isCredit]);
  if (!a || !c) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {invoice?.isCredit ? <Pill tone="info">Credit note</Pill> : <ClassBadge value={c} size="sm" />}
      <span className="text-sm text-muted-foreground">{invoice?.isCredit ? "Tracked separately · not audited or payable" : a.findings.length ? `${a.findings.length} finding${a.findings.length === 1 ? "" : "s"}` : "Nothing flagged by our checks (not a guarantee)"}</span>
      {state.invoices.find((i) => i.id === id)?.extraction === "mock" && <span className="rounded bg-bad-bg px-1.5 py-0.5 text-xs font-semibold text-bad">Simulated: file not read</span>}
      <Link href={`/invoices/${id}`} className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">{a.findings.length ? "See what we found" : "Open invoice"}</Link>
    </div>
  );
}

function JobRow({ job, busy, onRemove, onConfirm }: { job: Job; busy: boolean; onRemove: () => void; onConfirm: (e: ExtractedInvoice) => void }) {
  return (
    <motion.li layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }} className="px-5 py-4" data-state={job.state}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-line bg-canvas text-primary"><Icon name={job.name} type={job.type} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium">{job.name} {job.size ? <span className="font-normal text-muted-foreground">· {kb(job.size)}</span> : null}</p>
            {job.state !== "running" && !(busy && job.state === "ready") && <button type="button" onClick={onRemove} aria-label={`Remove ${job.name}`} className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-canvas hover:text-ink"><X className="size-4" /></button>}
          </div>
          {job.state === "ready" && <p className="text-sm text-muted-foreground">Ready to check</p>}
          {(job.state === "invalid" || job.state === "failed") && <p role="alert" className="mt-1 flex items-start gap-1.5 text-sm text-bad"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{job.error}</p>}
          {(job.state === "running" || job.state === "review") && (
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span aria-live="polite">{job.stage}…</span><span className="num">{job.progress}%</span></div>
              <div role="progressbar" aria-label={`Progress for ${job.name}`} aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-line"><motion.div className="h-full rounded-full bg-primary bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(255_255_255/0.14)_6px_12px)]" initial={false} animate={{ width: `${job.progress}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} /></div>
            </div>
          )}
          {job.state === "review" && job.extracted && <ReviewForm e={job.extracted} onConfirm={onConfirm} />}
          {job.state === "done" && job.invoiceId && <div className="mt-1.5"><ResultChip id={job.invoiceId} /></div>}
          {job.state === "done" && <p className="mt-1 text-xs text-muted-foreground">File contents not saved · only extracted fields kept (unencrypted, this browser)</p>}
        </div>
      </div>
    </motion.li>
  );
}

const LABELS: Record<FieldKey, string> = { vendorName: "vendor", number: "invoice number", date: "invoice date", dueDate: "due date", currency: "currency", total: "total" };

function ReviewForm({ e, onConfirm }: { e: ExtractedInvoice; onConfirm: (e: ExtractedInvoice) => void }) {
  const [v, setV] = useState({ vendorName: e.vendorName, number: e.number, date: e.date, dueDate: e.dueDate, currency: e.currency, total: e.total });
  const [checked, setChecked] = useState(e.lowConfidence.length === 0); // flagged fields must be explicitly reviewed
  const flagged = (k: FieldKey) => e.lowConfidence.includes(k);
  const valid = Boolean(v.vendorName.trim() && v.number.trim() && parseISO(v.date) !== null && parseISO(v.dueDate) !== null && isCurrency(v.currency) && isValidDecimal(v.total) && !v.total.trim().startsWith("-") && checked);
  const set = (k: keyof typeof v) => (ev: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: ev.target.value });
  return (
    <form className="mt-3 rounded-md border border-warn-line bg-warn-bg/40 p-4" onSubmit={(ev) => { ev.preventDefault(); if (valid) onConfirm({ ...e, ...v, lowConfidence: [] }); }}>
      <p className="mb-3 flex items-start gap-2 text-sm text-warn"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />Some invoice details couldn&apos;t be extracted confidently. Review the highlighted fields.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendor" htmlFor="rv-vendor" flagged={flagged("vendorName")}><input id="rv-vendor" className={fieldClass} value={v.vendorName} onChange={set("vendorName")} /></Field>
        <Field label="Invoice number" htmlFor="rv-number" flagged={flagged("number")}><input id="rv-number" className={fieldClass} value={v.number} onChange={set("number")} /></Field>
        <Field label="Invoice date" htmlFor="rv-date" flagged={flagged("date")} hint="YYYY-MM-DD"><input id="rv-date" className={fieldClass} value={v.date} onChange={set("date")} placeholder="2026-11-25" /></Field>
        <Field label="Due date" htmlFor="rv-due" flagged={flagged("dueDate")} hint="YYYY-MM-DD"><input id="rv-due" className={fieldClass} value={v.dueDate} onChange={set("dueDate")} placeholder="2026-12-25" /></Field>
        <Field label="Currency" htmlFor="rv-currency" flagged={flagged("currency")}><SelectMenu id="rv-currency" label="Currency" value={v.currency} searchable options={CURRENCIES.map((c) => ({ value: c, label: `${currencyName(c)} (${c})` }))} onChange={(currency) => setV({ ...v, currency })} /></Field>
        <Field label={`Total (${v.currency})`} htmlFor="rv-total" flagged={flagged("total")}><input id="rv-total" inputMode="decimal" className={fieldClass} value={v.total} onChange={set("total")} /></Field>
      </div>
      {e.lowConfidence.length > 0 && (
        <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" checked={checked} onChange={(ev) => setChecked(ev.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" />
          <span>I checked the highlighted fields ({e.lowConfidence.map((k) => LABELS[k]).join(", ")}) and they match my invoice.</span>
        </label>
      )}
      <div className="mt-3 flex justify-end"><Button type="button" variant="primary" disabled={!valid} onClick={() => valid && onConfirm({ ...e, ...v, total: v.total.trim(), lowConfidence: [] })}>Confirm and run audit</Button></div>
    </form>
  );
}

