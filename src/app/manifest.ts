import type { MetadataRoute } from "next";

/** Makes Overbill installable ("Add to Home Screen"). Everything still runs and stays in the browser. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Overbill",
    short_name: "Overbill",
    description: "Check invoices for overcharges and track what you get back. Your data stays on this device.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#15803d",
    orientation: "portrait",
    shortcuts: [
      { name: "Check an invoice", url: "/invoices/new" },
      { name: "Pay run", url: "/pay-run" },
      { name: "Recovery", url: "/recovery" },
    ],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
