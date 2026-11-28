import type { Metadata } from "next";
import { PageShell, Section } from "@/components/site/page-shell";

export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return (
    <PageShell title="Terms" intro="Plain rules for using this demo. They may change as Overbill grows.">
      <Section title="Findings are flags, not facts">
        <p>Overbill compares an invoice with the vendor&apos;s past invoices and the rates you entered. It lists what looks wrong. A flag can be mistaken: a price rise may be agreed, and a new fee may be in your contract.</p>
        <p>Amounts shown as recoverable are estimates, not promised refunds.</p>
      </Section>
      <Section title="Not advice">
        <p>Overbill is not financial, accounting or legal advice. Check your contract before you dispute a charge.</p>
      </Section>
      <Section title="Dispute notes">
        <p>Dispute notes are drafts. Read and edit them before you send them yourself. Overbill never sends anything.</p>
      </Section>
      <Section title="Example data in this demo">
        <ul>
          <li>The sample vendors and invoices are fictional.</li>
          <li>PDFs with a selectable text layer are read in your browser by pattern, so check the figures. Photos and scanned PDFs are read with on-device text recognition (OCR), which can misread a digit, so you confirm every field before the check runs. A file the reader cannot open at all gets example data chosen by its file name, marked Simulated and never counted in your totals.</li>
          <li>CSV files and pasted text are read for real.</li>
        </ul>
      </Section>
      <Section title="Your responsibility">
        <p>You decide what to pay and what to send. Do not use Overbill as your only control. It is provided as is, without warranty, and its makers are not liable for losses that follow from relying on it.</p>
      </Section>
    </PageShell>
  );
}
