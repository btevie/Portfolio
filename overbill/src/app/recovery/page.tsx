import type { Metadata } from "next";
import { Recovery } from "@/components/recovery";

export const metadata: Metadata = { title: "Recovery tracker" };
export default function Page() { return <Recovery />; }
