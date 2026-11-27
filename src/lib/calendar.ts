import type { Invoice } from "./types";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const day = (iso: string) => iso.replace(/-/g, "");
/** RFC 5545 asks for lines of at most 75 octets; fold longer ones. */
const fold = (line: string) => (line.length <= 73 ? line : line.match(/.{1,73}/g)!.join("\r\n "));

/**
 * An .ics calendar of invoice due dates, so reminders work in the phone's own calendar even when Overbill is closed.
 * Only unpaid invoices with a valid due date are included. `stamp` is injectable for tests.
 */
export function dueDatesCalendar(invoices: Invoice[], flagged: Set<string>, stamp = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const events = invoices
    .filter((i) => i.paymentStatus !== "paid" && !i.isCredit && /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate))
    .flatMap((i) => {
      const start = day(i.dueDate);
      const end = day(new Date(Date.parse(i.dueDate) + 86_400_000).toISOString().slice(0, 10));
      const hold = flagged.has(i.id);
      return [
        "BEGIN:VEVENT",
        `UID:${i.id}@overbill.local`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${end}`,
        fold(`SUMMARY:${esc(`${hold ? "Review before paying: " : "Pay "}${i.vendorName} ${i.number} (${i.total} ${i.currency})`)}`),
        fold(`DESCRIPTION:${esc(hold ? "Overbill flagged findings on this invoice. Review them before you pay." : "No issues detected by Overbill's checks. Not a guarantee.")}`),
        "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P2D", "DESCRIPTION:Invoice due in 2 days", "END:VALARM",
        "END:VEVENT",
      ];
    });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Overbill//Due dates//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n") + "\r\n";
}
