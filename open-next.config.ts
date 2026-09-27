import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default OpenNext configuration. No incremental cache is configured because
// every Armour Ops page is rendered per request (all pages read the session).
export default defineCloudflareConfig();
