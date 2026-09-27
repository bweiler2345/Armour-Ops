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

const nextConfig: NextConfig = {
  ...(devLanHosts.length > 0 ? { allowedDevOrigins: devLanHosts } : {}),
};

export default nextConfig;
