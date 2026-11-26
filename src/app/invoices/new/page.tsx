import type { Metadata } from "next";
import { UploadFlow } from "@/components/upload-flow";

export const metadata: Metadata = { title: "Upload invoice" };
export default function Page() { return <UploadFlow />; }
