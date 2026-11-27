import type { Metadata } from "next";
import { DataView } from "@/components/data-view";
import { PageShell } from "@/components/site/page-shell";

export const metadata: Metadata = { title: "Your data" };

export default function DataPage() {
  return (
    <PageShell title="Your data" intro="Everything lives in this browser. Back it up before you clear your browser or switch device.">
      <DataView />
    </PageShell>
  );
}
