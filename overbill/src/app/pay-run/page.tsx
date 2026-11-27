import type { Metadata } from "next";
import { PayRun } from "@/components/pay-run";

export const metadata: Metadata = { title: "Pay run" };
export default function Page() { return <PayRun />; }
