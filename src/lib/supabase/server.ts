import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/database.types";

// Creates a per-request Supabase client for Server Components, Server Actions
// and Route Handlers. Returns null when Supabase is not configured.
export async function createClient() {
  // Read cookies first so every caller is rendered per request, even when
  // Supabase is not configured yet.
  const cookieStore = await cookies();
  const config = getSupabaseConfig();
  if (!config) return null;

  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes the
          // session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
