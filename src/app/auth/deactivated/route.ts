import { NextResponse, type NextRequest } from "next/server";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

// The DAL sends signed-in users whose profile is missing or deactivated here.
// Route Handlers can write cookies, so the session is cleared before
// returning to the sign-in page.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();

  const url = new URL(SIGN_IN_PATH, request.url);
  url.searchParams.set("error", "inactive");
  return NextResponse.redirect(url);
}
