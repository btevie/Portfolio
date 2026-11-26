import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoiceDetail } from "@/components/invoice-detail";

export const metadata: Metadata = { title: "Invoice analysis" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><InvoiceDetail id={id} /></Suspense>;
}
