"use client";
import { parseContractText } from "@/lib/audit/contract-parser";
import { buildNegotiationPlaybook } from "@/lib/negotiation-intel";
import { SelectMenu } from "@/components/ui/select-menu";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Store, Trash2 } from "lucide-react";
import { D, formatMoney, isValidDecimal } from "@/lib/audit/money";
import { useVendorStats } from "@/lib/data/hooks";
import { detectRecurring } from "@/lib/data/selectors";
import { actions } from "@/lib/data/store";
import { fmtDate } from "@/lib/format";
import { parseISO } from "@/lib/audit/normalize";
import type { Vendor, VendorCategory } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button, Card, ClassBadge, Disclosure, EmptyState, Field, fieldClass, LinkButton, MotionRow, PageHeader, Pill, SectionHeader, Toggle } from "@/components/ui";
import { LineChart } from "@/components/charts";
import { statusTone } from "@/components/vendor-list";

const CATEGORIES: VendorCategory[] = ["Infrastructure", "Cloud usage", "Telecom", "Workspace", "Software", "Professional services", "Other"];

export function VendorDetail({ id }: { id: string }) {
  const { state, audits, stats } = useVendorStats();
  const s = stats.find((x) => x.vendor.id === id);
  const [expected, setExpected] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [rate, setRate] = useState({ match: "", unitPrice: "", unit: "hour" });
  const [rateErr, setRateErr] = useState("");
  const recurring = useMemo(() => (s ? detectRecurring(s.unique) : null), [s]);

  if (!s) return <Card><EmptyState icon={Store} title="Vendor not found" action={<LinkButton href="/vendors">Back to vendors</LinkButton>}>It may have been removed when demo data was reset.</EmptyState></Card>;
  const { vendor } = s;
  const cur = s.latest?.currency ?? state.settings.currency;
  const expectedCur = vendor.expectedCurrency ?? cur;
  const m = (v: string | number) => formatMoney(v, cur);
  const rates = state.contractRates.filter((r) => r.vendorId === vendor.id);
  const expectedValue = expected ?? vendor.expectedAmount ?? "";
  const points = s.unique.map((i) => ({ label: new Date(i.date + "T00:00:00Z").toLocaleString("en", { month: "short", timeZone: "UTC" }), value: Number(i.total), flagged: (audits[i.id]?.findings.length ?? 0) > 0 }));
  const avg = s.unique.length ? s.unique.reduce((a, i) => a + Number(i.total), 0) / s.unique.length : null;

  function saveExpected() {
    const v = expectedValue.trim();
    if (v && (!isValidDecimal(v) || D(v).lte(0))) { setSaved("Enter a positive amount, e.g. 120.00"); return; }
    actions.updateVendor(vendor.id, { expectedAmount: v ? D(v).toFixed(2) : undefined, expectedCurrency: v ? expectedCur : undefined });
    setExpected(null); setSaved(v ? "Expected amount saved." : "Expected amount cleared.");
  }

  function addRate(e: React.FormEvent) {
    e.preventDefault();
    if (!rate.match.trim() || !isValidDecimal(rate.unitPrice) || D(rate.unitPrice).lte(0)) { setRateErr("Enter a keyword from the line description and a positive unit price."); return; }
    actions.addContractRate({ vendorId: vendor.id, match: rate.match.trim(), unitPrice: D(rate.unitPrice).toFixed(2), unit: rate.unit.trim() || "unit", currency: cur });
    setRate({ match: "", unitPrice: "", unit: "hour" }); setRateErr("");
  }

  return (
    <>
      <p className="mb-1 text-sm"><Link href="/vendors" className="-ml-2 inline-flex min-h-11 items-center rounded-md px-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">← Vendors</Link></p>
      <PageHeader title={vendor.name} description={`${vendor.category} · ${vendor.billing === "variable" ? "Usage-based billing, wider tolerances apply" : "Fixed recurring billing"}`} actions={<Pill tone={statusTone(s.status)}>{s.status}</Pill>} />

      <section aria-label="Vendor figures" className="mb-5 grid grid-cols-2 divide-x divide-line overflow-hidden rounded-2xl bg-card ring-1 ring-line lg:grid-cols-4">
        {[["Invoices", String(s.invoiceCount)], ["Average charge", s.average ? m(s.average.toFixed(2)) : "—"], ["Latest charge", s.latest ? m(s.latest.total) : "—"], ["Change", s.changePct === null ? "—" : `${s.changePct > 0 ? "+" : ""}${s.changePct}%`]].map(([k, v]) => (
          <div key={k} className={cn("px-4 py-3", (k === "Invoices" || k === "Average charge") && "max-sm:hidden")}><p className="text-xs text-muted-foreground">{k}</p><p className="num mt-0.5 text-xl font-semibold tracking-tight">{v}</p></div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <SectionHeader title="Price history" description="Total per invoice. Dashed line is the average." />
            <div className="px-5 pt-3 pb-4">
              {s.unique.length < 2 ? <EmptyState icon={Store} title="Not enough history">Not enough history yet. Upload more invoices from this vendor.</EmptyState>
                : <LineChart points={points} average={avg} currency={cur} ariaLabel={`${vendor.name} invoice totals: ${points.map((p) => `${p.label} ${p.value}`).join(", ")}`} />}
            </div>
          </Card>

          <Card>
            <SectionHeader title="Invoice history" />
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-line-strong bg-canvas/60 text-left text-xs tracking-wider text-muted-foreground "><tr><th scope="col" className="px-5 py-2.5 font-medium">Invoice</th><th scope="col" className="px-3 py-2.5 font-medium">Date</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Total</th><th scope="col" className="px-5 py-2.5 font-medium">Result</th></tr></thead>
              <tbody className="divide-y divide-line">{s.invoices.map((i, n) => (
                <MotionRow key={i.id} i={n} className="hover:bg-canvas"><td className="px-5 py-2.5 font-medium"><Link href={`/invoices/${i.id}`} className="-my-3 inline-block py-3 hover:underline">{i.number}</Link></td><td className="px-3 py-2.5 text-muted-foreground">{fmtDate(i.date)}</td><td className="num px-3 py-2.5 text-right">{m(i.total)}</td><td className="px-5 py-2.5"><ClassBadge value={audits[i.id]?.classification ?? "CLEAR"} size="sm" /></td></MotionRow>
              ))}</tbody>
            </table></div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <SectionHeader title="Recurring charges" />
            <div className="px-5 py-4 text-sm">
              {recurring ? <p>Looks like a <strong>monthly</strong> charge of <strong className="num">{m(recurring.monthly.toFixed(2))}</strong>. Next invoice expected around <strong>{fmtDate(recurring.nextExpected)}</strong>.</p>
                : <p className="text-muted-foreground">No regular monthly pattern detected{vendor.billing === "variable" ? " (normal for usage-based billing)" : ""}.</p>}
            </div>
          </Card>

          <Card>
            <SectionHeader title="Detected anomalies" description="Anomalies are not confirmed errors." />
            {s.openFindings.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">Nothing flagged. That is not a guarantee.</p> : (
              <ul className="divide-y divide-line">{s.openFindings.map((f) => (
                <li key={f.id}><Link href={`/invoices/${f.invoiceId}?finding=${encodeURIComponent(f.id)}`} className="block px-5 py-3 hover:bg-canvas"><p className="text-sm font-medium">{f.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{f.actual} vs expected {f.expected}</p></Link></li>
              ))}</ul>
            )}
          </Card>

          {(() => {
            const pb = buildNegotiationPlaybook(vendor, s.invoices, new Date().toISOString().slice(0, 10));
            if (!pb) return null;
            return (
              <Card>
                <SectionHeader title="Forensic & negotiation profile" description={`Leverage: ${pb.leverageScore} · Forensic variance: ${pb.forensicLabel} (${pb.volatilityPct}%)`} />
                <div className="space-y-3 px-5 py-4 text-sm">
                  <div className="grid grid-cols-2 gap-2 rounded-xl bg-canvas p-3 text-xs">
                    <div><span className="text-muted-foreground">Est. annual spend</span><p className="num mt-0.5 font-semibold">{pb.annualizedSpend}</p></div>
                    <div><span className="text-muted-foreground">Settled bills</span><p className="num mt-0.5 font-semibold">{pb.onTimeRatePct}%</p></div>
                  </div>
                  <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
                    {pb.talkingPoints.map((pt, idx) => <li key={idx}>{pt}</li>)}
                  </ul>
                </div>
              </Card>
            );
          })()}

          <Disclosure title="What you expect to pay">
            <div className="space-y-3 px-5 py-4">
              <Field label={`Expected invoice total (${expectedCur})`} htmlFor="expected" hint={vendor.expectedAmount ? `Currently ${formatMoney(vendor.expectedAmount, expectedCur)}` : "Not set"}>
                <div className="flex gap-2"><input id="expected" inputMode="decimal" className={fieldClass} value={expectedValue} onChange={(e) => { setExpected(e.target.value); setSaved(""); }} placeholder="e.g. 145.20" /><Button onClick={saveExpected}>Save</Button></div>
              </Field>
              <p role="status" className="min-h-4 text-xs text-muted-foreground">{saved}</p>
            </div>
          </Disclosure>

          <Disclosure title="Agreed contract rates">
            <ul className="divide-y divide-line">{rates.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><span>“{r.match}”: <strong className="num">{formatMoney(r.unitPrice, r.currency)}</strong> / {r.unit}{r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}</span>
                <button type="button" aria-label={`Remove rate ${r.match}`} onClick={() => actions.removeContractRate(r.id)} className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-canvas hover:text-bad"><Trash2 className="size-4" /></button></li>
            ))}</ul>
            {rates.length === 0 && <p className="px-5 pt-4 text-sm text-muted-foreground">No agreed rates recorded for this vendor.</p>}
            <form onSubmit={addRate} className="grid grid-cols-[1fr_90px_80px] gap-2 px-5 py-4">
              <input aria-label="Line description keyword" placeholder="Keyword (e.g. consulting)" className={fieldClass} value={rate.match} onChange={(e) => setRate({ ...rate, match: e.target.value })} />
              <input aria-label="Agreed unit price" inputMode="decimal" placeholder="Rate" className={fieldClass} value={rate.unitPrice} onChange={(e) => setRate({ ...rate, unitPrice: e.target.value })} />
              <input aria-label="Unit" placeholder="Unit" className={fieldClass} value={rate.unit} onChange={(e) => setRate({ ...rate, unit: e.target.value })} />
              <Button variant="secondary" size="sm" className="col-span-3 justify-self-start" onClick={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}><Plus className="size-3.5" aria-hidden />Add rate</Button>
              {rateErr && <p role="alert" className="col-span-3 text-xs text-bad">{rateErr}</p>}
            </form>
          </Disclosure>

          <ContractCard key={vendor.id} vendor={vendor} />

          <Disclosure title="Monitoring">
            <div className="divide-y divide-line px-5">
              <Toggle id="mon-enabled" label="Monitor this vendor" description="Include price changes in Dashboard trend alerts. Existing invoice findings stay visible." checked={vendor.monitoring.enabled} onChange={(v) => actions.updateVendor(vendor.id, { monitoring: { ...vendor.monitoring, enabled: v } })} />
              <Toggle id="mon-notify" label="Notify me of anomalies" description="Show this vendor’s review and due-date reminders in the notification bell." checked={vendor.monitoring.notify} onChange={(v) => actions.updateVendor(vendor.id, { monitoring: { ...vendor.monitoring, notify: v } })} />
              <Toggle id="mon-variable" label="Usage-based billing" description="Charges vary; thresholds are widened 3×." checked={vendor.billing === "variable"} onChange={(v) => actions.updateVendor(vendor.id, { billing: v ? "variable" : "fixed" })} />
              <div className="py-3"><label htmlFor="mon-cat" className="mb-1.5 block text-sm font-medium">Category</label><SelectMenu id="mon-cat" label="Category" value={vendor.category} onChange={(v) => actions.updateVendor(vendor.id, { category: v as VendorCategory })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} /></div>
            </div>
          </Disclosure>
        </div>
      </div>
    </>
  );
}

/** Contract details you enter yourself. Used for the price-cap check and for renewal reminders; nothing is assumed. */
function ContractCard({ vendor }: { vendor: Vendor }) {
  const c = vendor.contract;
  const [renewal, setRenewal] = useState(c?.renewalDate ?? "");
  const [notice, setNotice] = useState(c?.noticeDays !== undefined ? String(c.noticeDays) : "");
  const [cap, setCap] = useState(c?.upliftCapPct ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [quoteText, setQuoteText] = useState("");
  function extractFromQuote() {
    const parsed = parseContractText(quoteText);
    if (!parsed.matchedNotes.length) return setMsg({ ok: false, text: "No renewal date, notice period, or % cap detected in that text." });
    if (parsed.renewalDate) setRenewal(parsed.renewalDate);
    if (parsed.noticeDays !== undefined) setNotice(String(parsed.noticeDays));
    if (parsed.upliftCapPct) setCap(parsed.upliftCapPct);
    setMsg({ ok: true, text: `Auto-filled from text (${parsed.matchedNotes.join(" · ")}). Click Save to apply.` });
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (renewal && parseISO(renewal) === null) return setMsg({ ok: false, text: "Enter the renewal date as a real date." });
    if (notice && !/^\d{1,3}$/.test(notice)) return setMsg({ ok: false, text: "Notice period is a whole number of days, up to 999." });
    if (cap && !/^\d{1,3}(\.\d{1,2})?$/.test(cap)) return setMsg({ ok: false, text: "The price cap is a percentage such as 5 or 7.5." });
    const next = { ...(renewal ? { renewalDate: renewal } : {}), ...(notice ? { noticeDays: Number(notice) } : {}), ...(cap ? { upliftCapPct: cap } : {}) };
    actions.updateVendor(vendor.id, { contract: Object.keys(next).length ? next : undefined });
    setMsg({ ok: true, text: Object.keys(next).length ? "Saved. Overbill will use these in its checks and reminders." : "Contract details cleared." });
  }

  return (
    <Disclosure title="Contract & renewal" subtitle="Optional: a price cap and a renewal date">
      <div className="mb-3 rounded-xl border border-border bg-muted/40 p-3">
        <label htmlFor="quote-text" className="block text-xs font-medium text-muted-foreground">Auto-fill from pasted quote or contract text (NL/EN)</label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input id="quote-text" type="text" placeholder="e.g. Verlenging 01-04-2027, opzegtermijn 1 maand, max 3% indexatie" className={fieldClass} value={quoteText} onChange={(e) => setQuoteText(e.target.value)} />
          <Button type="button" variant="secondary" size="sm" onClick={extractFromQuote}>Extract terms</Button>
        </div>
      </div>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">Renewal date<input type="date" className={`${fieldClass} mt-1.5`} value={renewal} onChange={(e) => setRenewal(e.target.value)} /></label>
        <label className="text-sm font-medium">Notice needed (days)<input inputMode="numeric" placeholder="e.g. 30" className={`${fieldClass} mt-1.5`} value={notice} onChange={(e) => setNotice(e.target.value)} /></label>
        <label className="text-sm font-medium">Price cap (%)<input inputMode="decimal" placeholder="e.g. 5" className={`${fieldClass} mt-1.5`} value={cap} onChange={(e) => setCap(e.target.value)} /></label>
        <p className="text-xs text-muted-foreground sm:col-span-3">A price above the cap is flagged as a likely error. You get a reminder before the notice deadline so you can cancel or renegotiate. Overbill only uses what you enter here.</p>
        <div className="flex items-center gap-3 sm:col-span-3"><Button type="submit" variant="primary" size="sm">Save</Button>{msg && <p role="status" className={msg.ok ? "text-sm text-ok" : "text-sm text-bad"}>{msg.text}</p>}</div>
      </form>
    </Disclosure>
  );
}
