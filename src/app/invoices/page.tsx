import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/skeletons";
import { InvoiceList } from "@/components/invoice-list";

export const metadata: Metadata = { title: "Invoices" };
export default function Page() { return <Suspense fallback={<ListSkeleton />}><InvoiceList /></Suspense>; }
