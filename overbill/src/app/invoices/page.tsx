import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoiceList } from "@/components/invoice-list";

export const metadata: Metadata = { title: "Invoices" };
export default function Page() { return <Suspense><InvoiceList /></Suspense>; }
