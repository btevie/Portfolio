import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/skeletons";
import { VendorList } from "@/components/vendor-list";

export const metadata: Metadata = { title: "Vendors" };
export default function Page() { return <Suspense fallback={<ListSkeleton kpis={false} />}><VendorList /></Suspense>; }
