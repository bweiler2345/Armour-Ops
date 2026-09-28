import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
// NextResponse from its own module: importing it from "next/server" also
// bundles next/og image generation (about 1.4 MB of WebAssembly) into the
// Cloudflare Worker, which this app never uses. Same class either way.
import { NextResponse } from "next/dist/server/web/spec-extension/response";
import { isPublicPath, SIGN_IN_PATH } from "@/lib/auth/routes";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/database.types";

// Refreshes the Supabase session cookie and sends signed-out visitors to the
// sign-in page. This is an optimistic check only: pages and Server Actions
// still verify the user and role through the DAL, and RLS protects the data.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  let signedIn = false;

  const config = getSupabaseConfig();
  if (config) {
    const supabase = createServerClient<Database>(
      config.url,
      config.publishableKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet, headers) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
            Object.entries(headers).forEach(([key, value]) =>
              response.headers.set(key, value),
            );
          },
        },
      },
    );

    // getClaims() validates the session token; do not trust getSession()
    // on the server.
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims);
  }

  const { pathname, search } = request.nextUrl;
  if (signedIn || isPublicPath(pathname)) return response;

  const url = request.nextUrl.clone();
  url.pathname = SIGN_IN_PATH;
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);

  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
