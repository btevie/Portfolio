"use client";
import { markBackedUp } from "@/lib/backup";
import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { Check, Download, RotateCcw, Trash2 } from "lucide-react";
import { RULE_META } from "@/lib/audit/engine";
import { actions, useAppState } from "@/lib/data/store";
import type { Currency, RuleId, Sensitivity } from "@/lib/types";
import { CURRENCIES, currencyName } from "@/lib/currencies";
import { SelectMenu } from "@/components/ui/select-menu";
import { EncryptedBackup } from "@/components/encrypted-backup";

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c, label: `${currencyName(c)} (${c})` }));
import { Avatar } from "@/components/avatar";
import { localAiStatus, setLocalAi, useLocalAi } from "@/lib/extraction/local-ai";
import { forgetLocalFlags } from "@/lib/get-started";
import { ProfilePictureDialog } from "@/components/profile-picture-dialog";
import { Button, Card, Disclosure, Field, fieldClass, Modal, PageHeader, PillTabs, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";

const TABS = [{ value: "account", label: "Profile" }, { value: "monitoring", label: "Monitoring" }, { value: "reminders", label: "Reminders" }, { value: "privacy", label: "Privacy & data" }] as const;
type Tab = (typeof TABS)[number]["value"];

const SENS: { id: Sensitivity; label: string; desc: string }[] = [
  { id: "relaxed", label: "Relaxed", desc: "Only larger changes are flagged (thresholds ×1.5)." },
  { id: "balanced", label: "Balanced", desc: "5% informational, 10% investigate, 20% high priority." },
  { id: "strict", label: "Strict", desc: "Smaller changes are flagged (thresholds ×0.6)." },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function LocalAiSection() {
  const on = useLocalAi();
  const [status, setStatus] = useState("");
  const change = async (v: boolean) => { setLocalAi(v); setStatus(v ? "Checking…" : ""); if (v) setStatus((await localAiStatus()).message); };
  return (
    <Section title="Local AI reader (optional)">
      <Card className="px-5">
        <Toggle id="local-ai" checked={on} onChange={change} label="Use a local AI model when a bill can't be read"
          description="Off by default. Uses Ollama running on this computer, so nothing leaves it. Medical documents are never sent to the AI reader." />
        {on && <p role="status" className="border-t border-line py-3 text-sm text-muted-foreground">{status || "On. Needs Ollama with llama3.2 (ollama pull llama3.2). Only works when Overbill is opened on this computer."}</p>}
      </Card>
    </Section>
  );
}

export function SettingsView() {
  const s = useAppState();
  // Edits are kept as a draft over the stored profile, so the form shows persisted values once the store hydrates.
  const [draft, setDraft] = useState<Partial<typeof s.user>>({});
  const profile = { name: draft.name ?? s.user.name, company: draft.company ?? s.user.company, email: draft.email ?? s.user.email };
  const setProfile = (p: typeof profile) => setDraft(p);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<Tab>("account");
  const [picDialog, setPicDialog] = useState(false);
  const [confirm, setConfirm] = useState<null | "reset" | "clear">(null);
  const st = s.settings;
  const toggleRule = (id: RuleId, on: boolean) => actions.updateSettings({ disabledRules: on ? st.disabledRules.filter((r) => r !== id) : [...st.disabledRules, id] });

  function exportData() {
    const blob = new Blob([JSON.stringify({ ...s, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "overbill-export.json"; a.click(); markBackedUp();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg("Exported your data as JSON.");
  }

  return (
    <>
      <PageHeader title="Settings" description="Most people never need to change these. Monitoring, reminder and currency changes save as soon as you make them; the profile needs “Save profile”." />
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        <AnimatePresence mode="wait" initial={false}>
          {msg && (
            <motion.p key={msg} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="inline-flex items-center gap-2 rounded-full border border-ok-line bg-card px-4 py-2 text-sm font-medium text-ok">
              <Check className="size-4" aria-hidden />{msg}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="max-w-2xl">
        <PillTabs id="settings" label="Settings sections" value={tab} onChange={setTab} items={TABS.map((t) => ({ ...t }))} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="mt-3 space-y-4">
            {tab === "account" && (<>
            <Section title="Profile">
            <Card>
              <form className="p-4" onSubmit={(e) => { e.preventDefault(); actions.updateUser(profile); setDraft({}); setMsg("Profile saved."); }}>
                <div className="mb-4 flex items-center gap-4">
                  <Avatar name={profile.name} email={profile.email} picture={s.user.picture} size={64} />
                  <Button type="button" onClick={() => setPicDialog(true)}>Change picture</Button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <Field label="Name" htmlFor="p-name"><input id="p-name" className={fieldClass} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
                  <Field label="Company" htmlFor="p-company"><input id="p-company" className={fieldClass} value={profile.company} onChange={(e) => setProfile({ ...profile, company: e.target.value })} /></Field>
                  <div className="col-span-2"><Field label="Email" htmlFor="p-email"><input id="p-email" type="email" className={fieldClass} value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field></div>
                </div>
                <div className="mt-4 flex items-center justify-end gap-3">
                  <Button variant="primary" onClick={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>Save profile</Button>
                </div>
              </form>
            </Card>
          </Section>
            <Section title="Currency">
            <Card className="overflow-visible p-4"><Field label="Preferred currency" htmlFor="currency"><SelectMenu id="currency" label="Preferred currency" className="max-w-xs" searchable value={st.currency} options={CURRENCY_OPTIONS} onChange={(v) => { actions.updateSettings({ currency: v as Currency }); setMsg(`Currency set to ${v}.`); }} /></Field></Card>
          </Section>
            </>)}
            {tab === "monitoring" && (<>
            <Section title="How strict should the checks be?">
            <p className="text-sm text-muted-foreground">This sets how big a price change has to be before we flag it. Balanced suits most people. Saved automatically.</p>
            <Card>
              <div role="radiogroup" aria-label="Monitoring sensitivity" className="grid gap-2 p-3 sm:grid-cols-3">
                {SENS.map((o) => (
                  <label key={o.id} className={cn("relative cursor-pointer rounded-lg border p-3.5 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary", st.sensitivity === o.id ? "border-transparent bg-primary-soft" : "border-line bg-raised hover:border-line-strong")}>
                    <input type="radio" name="sens" className="sr-only" checked={st.sensitivity === o.id} onChange={() => { actions.updateSettings({ sensitivity: o.id }); setMsg(`Sensitivity set to ${o.label.toLowerCase()}.`); }} />
                    {st.sensitivity === o.id && <motion.span layoutId="sens-ring" className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-primary" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                    <span className="block text-sm font-semibold">{o.label}</span><span className="mt-1 block text-xs text-muted-foreground">{o.desc}</span>
                  </label>
                ))}
              </div>
                              <div className="px-3 pb-3"><Disclosure title="Advanced: turn individual checks on or off" subtitle="Turning a check off means it will never flag anything"><div className="divide-y divide-line px-5">{RULE_META.map((r) => <Toggle key={r.id} id={`rule-${r.id}`} label={r.name} description={r.description} checked={!st.disabledRules.includes(r.id)} onChange={(on) => toggleRule(r.id, on)} />)}</div></Disclosure></div>
            </Card>
          </Section>
          {st.exceptions.length > 0 && (
            <Section title="Remembered as expected">
              <Card className="divide-y divide-line px-5">
                {st.exceptions.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span className="min-w-0"><span className="font-medium">{s.vendors.find((v) => v.id === e.vendorId)?.name ?? "Vendor"}</span> · {e.ruleId === "price_history" ? "price changes" : "extra fees"}{e.reason && <span className="block truncate text-xs text-muted-foreground">{e.reason}</span>}</span>
                    <Button size="sm" onClick={() => actions.removeVendorException(e.id)}>Flag again</Button>
                  </div>
                ))}
              </Card>
            </Section>
          )}
            </>)}
            {tab === "reminders" && (<>
            <Section title="Reminders">
            <p className="mb-2 text-sm text-muted-foreground">Show in-app reminders in the notification bell for overdue reviews, upcoming due dates and vendor replies. Nothing is emailed or pushed.</p>
            <Card className="divide-y divide-line px-5">
              <Toggle id="r-review" label="Overdue reviews" checked={st.reminders.overdueReview} onChange={(v) => actions.updateSettings({ reminders: { ...st.reminders, overdueReview: v } })} />
              <Toggle id="r-due" label="Upcoming due dates" checked={st.reminders.upcomingDue} onChange={(v) => actions.updateSettings({ reminders: { ...st.reminders, upcomingDue: v } })} />
              <Toggle id="r-reply" label="Vendor replies" checked={st.reminders.vendorReply} onChange={(v) => actions.updateSettings({ reminders: { ...st.reminders, vendorReply: v } })} />
            </Card>
          </Section>
            </>)}
            {tab === "privacy" && (<>
            <LocalAiSection />
            <Section title="Privacy">
            <Card className="divide-y divide-line px-5">
              <ul className="list-disc space-y-1.5 py-3 pl-5 text-sm text-muted-foreground"><li>Files are never uploaded or saved. Only the extracted fields are kept.</li><li>Those fields are stored <strong className="text-foreground">unencrypted</strong> in this browser.</li><li>Overbill never contacts vendors or banks.</li><li>There is no analytics or tracking of any kind, so there is nothing to switch off.</li></ul>
            </Card>
          </Section>
            <Section title="Data">
            <Card className="divide-y divide-line">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium">Export a copy</p><p className="text-sm text-muted-foreground">Download everything as a JSON file.</p></div><Button onClick={exportData}><Download className="size-4" aria-hidden />Export JSON</Button></div>
              <EncryptedBackup state={s} />
              <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium">Start over with the demo set</p><p className="text-sm text-muted-foreground">Restores the fictional invoices. Your preferences stay.</p></div><Button onClick={() => setConfirm("reset")}><RotateCcw className="size-4" aria-hidden />Reset demo data</Button></div>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium text-bad">Delete everything</p><p className="text-sm text-muted-foreground">Permanently removes all records and your profile.</p></div><Button variant="danger" onClick={() => setConfirm("clear")}><Trash2 className="size-4" aria-hidden />Delete all data</Button></div>
            </Card>
          </Section>
            </>)}
          </motion.div>
        </AnimatePresence>
      </div>

      <ProfilePictureDialog open={picDialog} onClose={() => setPicDialog(false)} name={profile.name} />
      <Modal open={confirm === "reset"} onClose={() => setConfirm(null)} title="Reset demo data?">
        <p className="text-sm text-muted-foreground">This restores the original demo data. Your profile and preferences are kept.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" onClick={() => { actions.resetDemo(); setConfirm(null); setMsg("Demo data restored."); }}>Reset demo data</Button></div>
      </Modal>
      <Modal open={confirm === "clear"} onClose={() => setConfirm(null)} title="Delete all data?">
        <p className="text-sm text-muted-foreground">This permanently removes all invoices, vendors and recovery cases, and blanks your profile. Export first if you want a copy.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={() => { actions.clearAll(); forgetLocalFlags(); setConfirm(null); setMsg("All data deleted."); }}>Delete everything</Button></div>
      </Modal>
    </>
  );
}
