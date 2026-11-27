import type { Metadata } from "next";
import { Hero } from "@/components/landing/hero";

export const metadata: Metadata = { title: { absolute: "Overbill: catch the overcharge before you pay it" } };

export default function Home() {
  return <Hero />;
}
