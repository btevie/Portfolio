import type { AppState } from "./types";
import type { Audits } from "./data/selectors";
import { isOpen } from "./data/selectors";
import { isSimulated } from "./evidence";
import { parseISO } from "./audit/normalize";

/** A real, user-entered date worth a calendar reminder. `date` is YYYY-MM-DD. */
export type Deadline = { uid: string; date: string; title: string; note: string };

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Dates derived only from data the user entered: unpaid invoices with open findings, contract notice dates, and follow-ups on disputes. */
export function upcomingDeadlines(state: AppState, audits: Audits, now = Date.now()): Deadline[] {
  const out: Deadline[] = [];
  const notify = (vendorId: string) => state.vendors.find((v) => v.id === vendorId)?.monitoring.notify !== false;
  for (const i of state.invoices) {
    if (i.isCredit || isSimulated(i) || i.paymentStatus === "paid" || !notify(i.vendorId)) continue;
    const due = parseISO(i.dueDate);
    if (due === null || !audits[i.id]?.findings.some((f) => isOpen(state, f))) continue;
    out.push({ uid: `due-${i.id}`, date: ymd(due), title: `Check before paying: ${i.vendorName}${i.number.trim() ? ` ${i.number}` : ""}`, note: "Open findings on this invoice. Review them before you pay." });
  }
  for (const v of state.vendors) {
    const c = v.contract;
    const renew = c?.renewalDate ? parseISO(c.renewalDate) : null;
    if (!c || renew === null || !notify(v.id)) continue;
    out.push({ uid: `notice-${v.id}-${c.renewalDate}`, date: ymd(renew - (c.noticeDays ?? 0) * DAY), title: `Decide: ${v.name} renewal notice`, note: `Renews ${c.renewalDate}. Last day to cancel or renegotiate.` });
  }
  const wait = state.settings.reminders.replyAfterDays;
  for (const c of state.recovery) {
    const t = Date.parse(c.updatedAt);
    if (c.status !== "disputed" || !Number.isFinite(t) || !notify(c.vendorId)) continue;
    out.push({ uid: `reply-${c.id}`, date: ymd(t + wait * DAY), title: `Follow up: ${c.vendorName}`, note: `No update expected after ${wait} days on "${c.title}".` });
  }
  return out.filter((d) => Date.parse(d.date) >= now - DAY).sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
// RFC 5545 lines are limited to 75 octets, continued with CRLF + space.
const fold = (line: string) => { const b = [...line]; const rows: string[] = []; let cur = "", len = 0; for (const ch of b) { const n = new TextEncoder().encode(ch).length; if (len + n > 74) { rows.push(cur); cur = ""; len = 0; } cur += ch; len += n; } rows.push(cur); return rows.join("\r\n "); };

/** All-day events with a 9:00 reminder the day before and on the day. Nothing leaves the device. */
export function buildIcs(deadlines: Deadline[], stamp = new Date()): string {
  const ts = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Overbill//Deadlines//EN", "CALSCALE:GREGORIAN"];
  for (const d of deadlines) {
    const start = d.date.replace(/-/g, "");
    const end = ymd(Date.parse(d.date) + DAY).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${d.uid}@overbill.local`, `DTSTAMP:${ts}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${esc(d.title)}`, `DESCRIPTION:${esc(d.note)}`,
      ...["-PT15H", "PT9H"].flatMap((t) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(d.title)}`, `TRIGGER:${t}`, "END:VALARM"]), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
