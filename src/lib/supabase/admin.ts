import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/database.types";

// Admin client using the Supabase secret key. It bypasses Row Level Security,
// so it must only be used in Server Actions after requireOwner() succeeds.
//
// The key is read from SUPABASE_SECRET_KEY (never NEXT_PUBLIC_). It is never
// logged, returned to the browser, or included in error messages. The
// `server-only` import makes the build fail if browser code imports this file.

function readSecretKey() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  // Guard against pasting the wrong key: the publishable key has no admin rights.
  if (key.startsWith("sb_publishable_")) return null;
  return key;
}

export function isAdminConfigured() {
  return getSupabaseConfig() !== null && readSecretKey() !== null;
}

export function createAdminClient() {
  const config = getSupabaseConfig();
  const secretKey = readSecretKey();
  if (!config || !secretKey) return null;

  return createClient<Database>(config.url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
