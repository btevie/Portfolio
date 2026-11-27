import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Section } from "@/components/site/page-shell";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  ["Add your bill", "Upload a CSV or paste invoice text to read it in your browser. Text PDFs are parsed there too. Photos and scanned PDFs use on-device text recognition (OCR), then ask you to confirm the highlighted fields. A PDF the reader cannot open may show a clearly labelled simulated example instead."],
  ["Overbill checks it", "It runs eight checks against the invoice, that vendor's earlier invoices and the rates you entered."],
  ["You decide", "Confirm a finding, dismiss it, or draft a dispute note to send yourself."],
  ["Track the money", "Follow each case from flagged to recovered on the Recovery page."],
];

const CHECKS: [string, string][] = [
  ["Arithmetic", "3 × €49.00 should be €147.00, but the line shows €174.00. The difference is €27.00."],
  ["Tax", "21% tax on €100.00 is €21.00, but the invoice charges €25.00."],
  ["Duplicate invoices", "Orbit Workspace invoice OW-2211 for €338.80 appears twice, with the same number and total."],
  ["Duplicate line items", "The same item, quantity and price is listed twice on one invoice."],
  ["Dates and terms", "The due date is before the invoice date, or the payment terms shrank from 30 days to 14."],
  ["Price history", "Northwind Hosting usually costs €145.20. This month it is €166.98, which is 15% more."],
  ["Contract rates", "You agreed €90.00 an hour. A line bills €96.00 an hour."],
  ["Unexpected fees", "A €9.08 “network administration fee” appears that was never on this vendor's earlier invoices."],
];

export default function HowItWorks() {
  return (
    <PageShell title="How it works" intro="Overbill reads an invoice, compares it with what that vendor charged before, and lists anything that looks wrong. You make the call.">
      <Section title="Four steps">
        <ol className="space-y-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex gap-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-green-700 text-base font-semibold text-white">{i + 1}</span>
              <p><strong>{t}.</strong> {d}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="The eight checks, with examples">
        <ul className="!list-none !space-y-5 !pl-0">
          {CHECKS.map(([name, ex]) => (
            <li key={name}><p><strong>{name}.</strong></p><p>{ex}</p></li>
          ))}
        </ul>
      </Section>
      <Section title="Plain-English terms">
        <ul className="!list-none !space-y-3 !pl-0">
          <li><strong>Possible overcharge / at stake.</strong> Money you might get back if a finding turns out to be real. It is not confirmed and not money you have.</li>
          <li><strong>Confidence (&ldquo;how sure are we&rdquo;).</strong> How strong the evidence is. A clear arithmetic mistake is more certain than a price rise, which may be agreed.</li>
          <li><strong>Confirmed error.</strong> A finding you have decided is wrong. Only you can set this.</li>
          <li><strong>Recovery.</strong> Following a dispute until the vendor refunds or credits you. &ldquo;Money received&rdquo; only counts what you mark as received.</li>
          <li><strong>Nothing flagged.</strong> Our checks found nothing unusual. It does not prove the invoice is right.</li>
        </ul>
      </Section>
      <Section title="What Overbill cannot know">
        <p>Overbill flags a problem. It does not prove one. A price rise can be agreed, and a new fee can be in your contract. Every finding stays unconfirmed until you decide, and the working is shown so you can check it.</p>
        <p>It only knows what is in the invoices you add and the rates you enter. A vendor with no history gets fewer checks.</p>
      </Section>
      <div className="flex flex-wrap gap-3">
        <Link href="/demo" className="inline-flex h-14 items-center rounded-full bg-green-700 px-7 text-base font-semibold text-white hover:bg-green-800">Try with sample data</Link>
        <Link href="/invoices/new" className="inline-flex h-14 items-center rounded-full border px-7 text-base font-semibold hover:bg-muted">Check an invoice</Link>
      </div>
    </PageShell>
  );
}
