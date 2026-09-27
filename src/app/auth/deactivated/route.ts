import { redirect } from "next/navigation";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

// The DAL sends signed-in users whose profile is missing or deactivated here.
// Route Handlers can write cookies, so the session is cleared before
// returning to the sign-in page.
export async function GET() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();

  // A relative redirect avoids depending on the request host, which the
  // Cloudflare Workers runtime reports as an internal address.
  redirect(`${SIGN_IN_PATH}?error=inactive`);
}
