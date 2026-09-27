"use server";

import { redirect } from "next/navigation";
import { homePathFor, isAppRole } from "@/lib/auth/roles";
import { safeNextPath, SIGN_IN_PATH } from "@/lib/auth/routes";
import {
  MESSAGES,
  signInErrorMessage,
  validateSignIn,
  type SignInState,
} from "@/lib/auth/sign-in";
import { createClient } from "@/lib/supabase/server";

// Sign-in is the one action that runs without a session. It validates input
// on the server and never reveals whether an email address has an account.
export async function signIn(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const input = validateSignIn({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!input.ok) {
    return { email: input.email, fieldErrors: input.fieldErrors };
  }

  const supabase = await createClient();
  if (!supabase) return { email: input.email, error: MESSAGES.notConfigured };

  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (error || !data.user) {
    return {
      email: input.email,
      error: error ? signInErrorMessage(error) : MESSAGES.unknown,
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.active || !isAppRole(profile.role)) {
    await supabase.auth.signOut();
    return { email: input.email, error: MESSAGES.inactive };
  }

  redirect(safeNextPath(formData.get("next"), homePathFor(profile.role)));
}

export async function signOut() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect(SIGN_IN_PATH);
}
