import type { Metadata } from "next";
import { PaymentsCheck } from "@/components/payments-check";

export const metadata: Metadata = { title: "Bank statement check" };
export default function Page() { return <PaymentsCheck />; }
