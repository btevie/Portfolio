"use client";
import { useState } from "react";
import { Download, RotateCcw, Trash2 } from "lucide-react";
import { RULE_META } from "@/lib/audit/engine";
import { actions, useAppState } from "@/lib/data/store";
import type { Currency, RuleId, Sensitivity } from "@/lib/types";
import { Button, Card, Field, fieldClass, Modal, PageHeader, SectionHeader, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";

const SENS: { id: Sensitivity; label: string; desc: string }[] = [
  { id: "relaxed", label: "Relaxed", desc: "Only larger changes are flagged (thresholds ×1.5)." },
  { id: "balanced", label: "Balanced", desc: "5% informational, 10% investigate, 20% high priority." },
  { id: "strict", label: "Strict", desc: "Smaller changes are flagged (thresholds ×0.6)." },
];

export function SettingsView() {
  const s = useAppState();
  // Edits are kept as a draft over the stored profile, so the form shows persisted values once the store hydrates.
  const [draft, setDraft] = useState<Partial<typeof s.user>>({});
  const profile = { name: draft.name ?? s.user.name, company: draft.company ?? s.user.company, email: draft.email ?? s.user.email };
  const setProfile = (p: typeof profile) => setDraft(p);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<null | "reset" | "clear">(null);
  const st = s.settings;
  const toggleRule = (id: RuleId, on: boolean) => actions.updateSettings({ disabledRules: on ? st.disabledRules.filter((r) => r !== id) : [...st.disabledRules, id] });

  function exportData() {
    const blob = new Blob([JSON.stringify({ ...s, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "overbill-export.json"; a.click();
    URL.revokeObjectURL(a.href);
    setMsg("Exported your data as JSON.");
  }

  return (
    <>
      <PageHeader title="Settings" description="Changes are saved to this browser immediately." />
      <p role="status" className="mb-3 min-h-5 text-[13px] text-ok">{msg}</p>
      <div className="max-w-3xl space-y-6">
        <Card>
          <SectionHeader title="Account profile" description="Used to sign dispute notes. Not shared with anyone." />
          <form className="grid gap-4 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); actions.updateUser(profile); setDraft({}); setMsg("Profile saved."); }}>
            <Field label="Name" htmlFor="p-name"><input id="p-name" className={fieldClass} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
            <Field label="Company" htmlFor="p-company"><input id="p-company" className={fieldClass} value={profile.company} onChange={(e) => setProfile({ ...profile, company: e.target.value })} /></Field>
            <Field label="Email" htmlFor="p-email"><input id="p-email" type="email" className={fieldClass} value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
            <div className="flex items-end"><Button variant="primary" onClick={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>Save profile</Button></div>
          </form>
        </Card>

        <Card>
          <SectionHeader title="Currency" description="Default for new invoices and for dashboard totals. Amounts are never converted between currencies." />
          <div className="p-5"><Field label="Preferred currency" htmlFor="currency"><select id="currency" className={`${fieldClass} max-w-xs`} value={st.currency} onChange={(e) => { actions.updateSettings({ currency: e.target.value as Currency }); setMsg(`Currency set to ${e.target.value}.`); }}><option value="EUR">Euro (EUR)</option><option value="USD">US dollar (USD)</option><option value="GBP">Pound sterling (GBP)</option></select></Field></div>
        </Card>

        <Card>
          <SectionHeader title="Monitoring sensitivity" description="How readily price increases are flagged. Usage-based vendors always get wider tolerances." />
          <div role="radiogroup" aria-label="Monitoring sensitivity" className="grid gap-3 p-5 sm:grid-cols-3">
            {SENS.map((o) => (
              <label key={o.id} className={cn("cursor-pointer rounded-md border p-3.5 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary", st.sensitivity === o.id ? "border-primary bg-primary-soft" : "border-line-strong hover:bg-canvas")}>
                <input type="radio" name="sens" className="sr-only" checked={st.sensitivity === o.id} onChange={() => { actions.updateSettings({ sensitivity: o.id }); setMsg(`Sensitivity set to ${o.label.toLowerCase()}.`); }} />
                <span className="block text-sm font-semibold">{o.label}</span><span className="mt-1 block text-xs text-muted">{o.desc}</span>
              </label>
            ))}
          </div>
          <div className="border-t border-line px-5 py-2">
            <p className="pt-3 pb-1 text-[13px] font-medium">Checks</p>
            <div className="divide-y divide-line">{RULE_META.map((r) => <Toggle key={r.id} id={`rule-${r.id}`} label={r.name} description={r.description} checked={!st.disabledRules.includes(r.id)} onChange={(on) => toggleRule(r.id, on)} />)}</div>
          </div>
        </Card>

        <Card>
          <SectionHeader title="Notifications" description="Stored as preferences. This demo sends no email or push messages." />
          <div className="divide-y divide-line px-5">
            <Toggle id="n-digest" label="Weekly digest" description="A summary of what changed across your vendors." checked={st.notifications.weeklyDigest} onChange={(v) => actions.updateSettings({ notifications: { ...st.notifications, weeklyDigest: v } })} />
            <Toggle id="n-high" label="High-severity alerts" description="Duplicates, arithmetic errors and contract-rate breaches." checked={st.notifications.highSeverityAlerts} onChange={(v) => actions.updateSettings({ notifications: { ...st.notifications, highSeverityAlerts: v } })} />
            <Toggle id="n-price" label="Price-change alerts" checked={st.notifications.priceChangeAlerts} onChange={(v) => actions.updateSettings({ notifications: { ...st.notifications, priceChangeAlerts: v } })} />
          </div>
        </Card>

        <Card>
          <SectionHeader title="Privacy" />
          <div className="divide-y divide-line px-5">
            <ul className="list-disc space-y-1.5 py-4 pl-5 text-sm text-muted"><li>Uploaded files are read in your browser and discarded; they are never stored or sent anywhere.</li><li>Extracted fields are kept in this browser&apos;s local storage only.</li><li>Overbill never emails vendors, connects to banks or initiates payments.</li></ul>
            <Toggle id="priv-analytics" label="Anonymous usage analytics" description="Off by default. This demo doesn't collect any." checked={st.privacy.analytics} onChange={(v) => actions.updateSettings({ privacy: { ...st.privacy, analytics: v } })} />
          </div>
        </Card>

        <Card>
          <SectionHeader title="Data management" description={`${s.invoices.length} invoices · ${s.vendors.length} vendors · ${s.recovery.length} recovery records on this device.`} />
          <div className="flex flex-wrap gap-3 p-5">
            <Button onClick={exportData}><Download className="size-4" aria-hidden />Export JSON</Button>
            <Button onClick={() => setConfirm("reset")}><RotateCcw className="size-4" aria-hidden />Reset demo data</Button>
            <Button variant="danger" onClick={() => setConfirm("clear")}><Trash2 className="size-4" aria-hidden />Delete all data</Button>
          </div>
        </Card>
      </div>

      <Modal open={confirm === "reset"} onClose={() => setConfirm(null)} title="Reset demo data?">
        <p className="text-sm text-muted">This replaces all invoices, vendors, recovery records and decisions with the original fictional demo set. Your profile and settings are kept.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" onClick={() => { actions.resetDemo(); setConfirm(null); setMsg("Demo data restored."); }}>Reset demo data</Button></div>
      </Modal>
      <Modal open={confirm === "clear"} onClose={() => setConfirm(null)} title="Delete all data?">
        <p className="text-sm text-muted">This permanently removes every invoice, vendor, contract rate and recovery record from this browser. Export first if you want a copy. You can restore the demo set afterwards.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={() => { actions.clearAll(); setConfirm(null); setMsg("All data deleted."); }}>Delete everything</Button></div>
      </Modal>
    </>
  );
}
