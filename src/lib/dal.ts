import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { homePathFor, isAppRole, type AppRole } from "@/lib/auth/roles";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

// Data Access Layer: the authoritative auth check in app code. Every page,
// Server Action, and Route Handler that touches app data must call
// requireUser() or requireOwner(). Row Level Security backs this up in the
// database.

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: AppRole;
  mustChangePassword: boolean;
};

export type Session =
  | { status: "signed_out" }
  | { status: "inactive" }
  | { status: "active"; user: CurrentUser };

export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  if (!supabase) return { status: "signed_out" };

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return { status: "signed_out" };

  // Role and active flag come from the database, never from the token.
  // select("*") keeps sign-in working even before a newer migration adds
  // columns (a missing column in the list would fail the whole query).
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", claims.sub)
    .maybeSingle();

  if (!profile || !profile.active || !isAppRole(profile.role)) {
    return { status: "inactive" };
  }

  return {
    status: "active",
    user: {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      fullName: profile.full_name,
      role: profile.role,
      mustChangePassword: profile.must_change_password === true,
    },
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (session.status === "signed_out") redirect(SIGN_IN_PATH);
  if (session.status === "inactive") redirect("/auth/deactivated");
  return session.user;
}

export async function requireOwner(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "owner") redirect(homePathFor(user.role));
  return user;
}
