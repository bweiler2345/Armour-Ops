import type { NextConfig } from "next";
import { parseDevLanHosts } from "./src/lib/dev-origins";

// Development only: lets a phone on the same network open the dev server by
// the computer's LAN address (for example http://192.168.1.20:3000). Next.js
// blocks its dev scripts for any host other than localhost unless listed
// here, so the page loads but never becomes interactive. The address comes
// from DEV_LAN_HOSTS in .env.local (never committed) and is ignored in
// production builds.
//
// Server Actions need no change: the phone's requests come from the same
// host they are sent to, so Next.js's origin (CSRF) check still applies and
// passes as usual.
const devLanHosts =
  process.env.NODE_ENV === "development" ? parseDevLanHosts(process.env.DEV_LAN_HOSTS) : [];

// Security headers for every response. Kept compatible with what the app
// does: uploads go from the browser straight to R2 (PUT to another origin),
// proof and reference pictures load through redirects to short-lived R2
// links, and the phone camera is opened through ordinary file inputs (no
// camera permission needed). No scripts from other sites are used.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  ...(devLanHosts.length > 0 ? { allowedDevOrigins: devLanHosts } : {}),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
