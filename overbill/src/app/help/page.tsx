import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/site/page-shell";

export const metadata: Metadata = { title: "Help" };

const FAQ: [string, string][] = [
  ["What files can I check?", "CSV files, pasted invoice text and PDFs with a selectable text layer are read in your browser (PDF layout is matched by pattern, so check the figures). Photos and scans use example data in this demo: the file name picks a sample, and the result says it is simulated. A PDF that cannot be opened at all also gets example data, marked simulated."],
  ["Where does my data go?", "Nowhere. It is saved in this browser only. Files are never uploaded or kept."],
  ["What do “Likely error” and “Review needed” mean?", "Likely error means the evidence is strong, for example a duplicate or a sum that does not add up. Review needed means something looks unusual and is worth a look. Neither is confirmed until you decide."],
  ["A finding is wrong. What now?", "Open the invoice and choose “Dismiss, this is expected”. It stops counting toward the amounts at stake."],
  ["What if I clear my browser data?", "Everything is lost. Download a backup from Your data first, and restore it from the same page."],
  ["Does Overbill email vendors or pay bills?", "No. It never contacts vendors, banks or payment services. You copy a dispute note and send it yourself."],
  ["Does logging in protect my data?", "No. Log in and Sign up only set up a profile in this browser, and the password is not stored or checked. Anyone using the same browser profile can open your data. Use a private device and keep a backup."],
  ["Is it free?", "Yes. There is no server to pay for."],
  ["How do I report a problem?", "This demo has no support inbox yet."],
];

export default function Help() {
  return (
    <PageShell title="Help" intro="Short answers to the questions people ask first.">
      <div className="divide-y rounded-2xl border">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group px-5 py-1">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold sm:text-lg">{q}<span aria-hidden className="text-xl text-muted-foreground transition-transform group-open:rotate-45">+</span></summary>
            <p className="pb-4 text-base leading-relaxed text-muted-foreground sm:text-lg">{a}</p>
          </details>
        ))}
      </div>
      <p className="text-base text-muted-foreground">Want the details of each check? Read <Link href="/how-it-works" className="font-semibold text-green-700 underline dark:text-green-500">how it works</Link>.</p>
    </PageShell>
  );
}
