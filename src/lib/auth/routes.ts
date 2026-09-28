export const SIGN_IN_PATH = "/sign-in";
// The health check answers without a session (it reveals nothing).
export const HEALTH_PATH = "/api/health";

// Routes reachable without a session. Everything else requires sign-in.
export function isPublicPath(pathname: string) {
  return pathname === SIGN_IN_PATH || pathname.startsWith("/auth/") || pathname === HEALTH_PATH;
}

// Only allow same-site relative paths after sign-in, so a crafted
// `?next=` link cannot send someone to another website.
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (isPublicPath(value.split(/[?#]/)[0])) return fallback;
  return value;
}
