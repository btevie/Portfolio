import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailSkeleton } from "@/components/skeletons";
import { InvoiceDetail } from "@/components/invoice-detail";

export const metadata: Metadata = { title: "Invoice analysis" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<DetailSkeleton />}><InvoiceDetail id={id} /></Suspense>;
}
