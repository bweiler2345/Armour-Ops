"use server";

import { revalidatePath } from "next/cache";
import {
  validatePasswordChange,
  type PasswordChangeFieldErrors,
} from "@/lib/auth/account-validation";
import { signInErrorMessage } from "@/lib/auth/sign-in";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export type ChangePasswordState = {
  status?: "changed";
  error?: string;
  fieldErrors?: PasswordChangeFieldErrors;
};

// Any signed-in user can change their own password. The current password is
// re-checked first so an unlocked phone left on a job site cannot be used to
// take over the account. Passwords are never logged.
export async function changePassword(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser();

  const input = validatePasswordChange({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!input.ok) return { fieldErrors: input.fieldErrors };

  const supabase = await createClient();
  if (!supabase || !user.email) {
    return { error: "Password changes aren’t available right now. Try again later." };
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });
  if (verifyError) {
    if (verifyError.code === "invalid_credentials" || verifyError.status === 400) {
      return { fieldErrors: { currentPassword: "That isn’t your current password." } };
    }
    return { error: signInErrorMessage(verifyError) };
  }

  const { error } = await supabase.auth.updateUser({
    password: input.newPassword,
  });
  if (error) {
    switch (error.code) {
      case "same_password":
        return {
          fieldErrors: {
            newPassword: "Choose a password different from your current one.",
          },
        };
      case "weak_password":
        return {
          fieldErrors: {
            newPassword: "That password is too weak. Try a longer one.",
          },
        };
      case "reauthentication_needed":
        return {
          error:
            "Password changes are blocked by a Supabase setting. Ask the owner to turn off “Secure password change”.",
        };
    }
    console.error("[account] updateUser failed", { code: error.code, status: error.status });
    return { error: "Your password couldn’t be changed. Try again." };
  }

  const { error: recordError } = await supabase.rpc("record_own_password_change");
  if (recordError) {
    console.error("[account] record_own_password_change failed", {
      code: recordError.code,
    });
  }

  revalidatePath("/", "layout");
  return { status: "changed" };
}
