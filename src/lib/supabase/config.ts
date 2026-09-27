// Reads the public Supabase settings. Returns null when they are missing so
// the app can fail closed (everything redirects to sign-in, and sign-in shows
// a "not connected" notice) instead of crashing.
export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}
