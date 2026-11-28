import type { Metadata, Viewport } from "next";
import { Fira_Code, Fira_Sans, Manrope } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { PwaRegister } from "@/components/pwa-register";
import { MirrorRestore } from "@/components/mirror-restore";
import { cn } from "@/lib/utils";

const firaSans = Fira_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-fira-sans" });
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-display" });
const firaCode = Fira_Code({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-fira-code" });

export const metadata: Metadata = {
  title: { default: "Overbill", template: "%s · Overbill" },
  description: "Know what changed, what looks wrong, and what you could be overpaying, before you pay.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Overbill", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#eef1f8" }, { media: "(prefers-color-scheme: dark)", color: "#020617" }], colorScheme: "dark light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={cn("h-full", "antialiased", "font-sans", firaSans.variable, firaCode.variable, manrope.variable)}>
      <head suppressHydrationWarning><script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("overbill:theme");if(!t)t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){}` }} /></head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
        <PwaRegister />
        <MirrorRestore />
      </body>
    </html>
  );
}
