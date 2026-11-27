import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Section } from "@/components/site/page-shell";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <PageShell title="Privacy" intro="Overbill has no server. Everything you enter stays in this browser.">
      <Section title="Where your data lives">
        <p>Your invoices, vendors, recovery cases and profile are saved in this browser&apos;s local storage. Overbill does not receive them and cannot see them.</p>
      </Section>
      <Section title="What is saved, and what is not">
        <ul>
          <li><strong>Saved:</strong> the details read from an invoice (vendor, number, dates, lines, amounts), your decisions, your notes and your settings.</li>
          <li><strong>Not saved:</strong> the files you add. CSV files and pasted text are read in your browser and then dropped.</li>
        </ul>
      </Section>
      <Section title="Not encrypted">
        <p>The saved details are <strong>not encrypted</strong>. Anyone who can use this browser profile can read them, and so can browser extensions you have installed. Use a private device.</p>
      </Section>
      <Section title="If you clear your browser data">
        <p>Everything is lost. There is no copy anywhere else and nobody can recover it for you. Make a backup from <Link href="/data" className="font-semibold text-green-700 underline dark:text-green-500">Your data</Link> before you clear anything.</p>
      </Section>
      <Section title="Profile, log in and passwords">
        <p>Sign up and Log in only set up or look up a profile (name, email and an optional picture) saved in this browser. The password field is <strong>not stored or checked</strong>, and nothing prevents someone else using this browser profile from opening Overbill. Do not reuse a real password here.</p>
      </Section>
      <Section title="Third parties">
        <p>Overbill has no analytics, advertising or tracking scripts. It never contacts vendors, banks or payment services, and it does not send emails.</p>
        <p>The one exception is <strong>Sign in with Google</strong>, if it has been switched on for this site. Then signing in loads Google&apos;s sign-in script, Google learns that you visited, and your Google picture is shown from Google&apos;s servers. Your invoices are never sent.</p>
      </Section>
    </PageShell>
  );
}
