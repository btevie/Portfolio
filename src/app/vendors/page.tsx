import type { Metadata } from "next";
import { Suspense } from "react";
import { VendorList } from "@/components/vendor-list";

export const metadata: Metadata = { title: "Vendors" };
export default function Page() { return <Suspense><VendorList /></Suspense>; }
