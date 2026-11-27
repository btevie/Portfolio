import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Overbill has no server-side data and no third-party origins, so everything is locked to 'self'.
 * Scripts/styles keep 'unsafe-inline' because a nonce would force every page to render dynamically; that means this CSP
 * limits *where* code can load from and what the page can connect to, but is not a strong XSS mitigation on its own.
 * Dev needs 'unsafe-eval' and websockets for React debugging / HMR.
 */
const google = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID; // only widen the policy when Google sign-in is switched on

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}${google ? " https://accounts.google.com/gsi/client" : ""}`,
  `style-src 'self' 'unsafe-inline'${google ? " https://accounts.google.com/gsi/style" : ""}`,
  `img-src 'self' data: blob:${google ? " https://*.googleusercontent.com" : ""}`,
  ...(google ? ["frame-src https://accounts.google.com/gsi/"] : []),
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}${google ? " https://accounts.google.com/gsi/" : ""}`,
  "worker-src 'self'", // pdf.js reads PDFs in a same-origin worker; nothing is fetched from elsewhere
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Invoices are sensitive: never let them be framed or sniffed, and keep referrers private.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: csp },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }, // ignored over plain http; applies when served via HTTPS
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default nextConfig;
