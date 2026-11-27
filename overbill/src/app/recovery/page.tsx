import type { Metadata } from "next";
import { Suspense } from "react";
import { Recovery } from "@/components/recovery";

export const metadata: Metadata = { title: "Recovery tracker" };
export default function Page() { return <Suspense><Recovery /></Suspense>; }
