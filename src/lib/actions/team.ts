"use server";

import { revalidatePath } from "next/cache";
import { validateNewEmployee } from "@/lib/auth/account-validation";
import { generateTemporaryPassword } from "@/lib/auth/temporary-password";
import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CreateEmployeeResult,
  ResetPasswordResult,
  SetActiveResult,
} from "@/lib/team/types";

// Owner-only account administration. Every action calls requireOwner() before
// touching the admin client. Temporary passwords are returned once to the
// owner's browser and are never stored or logged. Errors are logged by code
// only, never with messages, emails, passwords, or keys.

const TEAM_PATH = "/owner/team";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Supabase ban length used for deactivated accounts (about 100 years).
const DEACTIVATED_BAN = "876000h";

const MESSAGES = {
  notConfigured:
    "Team management isn’t connected yet. The server secret key is missing. See docs/SUPABASE_SETUP.md.",
  emailExists:
    "An account with this email already exists. Look for it in the lists below.",
  generic: "Something went wrong. Nothing was changed. Try again.",
  notFound: "That account couldn’t be found. Refresh the page and try again.",
  self: "You can’t do this to your own account here.",
  inactive: "Reactivate this account before resetting its password.",
  lastOwner: "The last active owner can’t be deactivated.",
} as const;

function logFailure(action: string, error: unknown) {
  const detail =
    error && typeof error === "object"
      ? {
          code: "code" in error ? String(error.code) : undefined,
          status: "status" in error ? String(error.status) : undefined,
        }
      : {};
  console.error(`[team] ${action} failed`, detail);
}

export async function createEmployee(
  formData: FormData,
): Promise<CreateEmployeeResult> {
  const owner = await requireOwner();

  const input = validateNewEmployee({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
  });
  if (!input.ok) {
    return {
      status: "invalid",
      fieldErrors: input.fieldErrors,
      values: { fullName: input.fullName, email: input.email },
    };
  }
  const values = { fullName: input.fullName, email: input.email };

  const admin = createAdminClient();
  if (!admin) return { status: "error", message: MESSAGES.notConfigured, values };

  const temporaryPassword = generateTemporaryPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  if (error || !data.user) {
    if (error?.code === "email_exists") {
      return { status: "error", message: MESSAGES.emailExists, values };
    }
    logFailure("createUser", error);
    return { status: "error", message: MESSAGES.generic, values };
  }

  const { error: recordError } = await admin.rpc(
    "admin_record_account_created",
    { p_target: data.user.id, p_actor: owner.id, p_full_name: input.fullName },
  );
  if (recordError) {
    // Roll back so a half-created account cannot sign in without a record.
    logFailure("admin_record_account_created", recordError);
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
    if (deleteError) logFailure("deleteUser rollback", deleteError);
    return {
      status: "error",
      message: `${MESSAGES.generic} If this keeps happening, make sure the Phase 1B database update has been run.`,
      values,
    };
  }

  revalidatePath(TEAM_PATH);
  return {
    status: "created",
    fullName: input.fullName,
    email: input.email,
    temporaryPassword,
  };
}

export async function resetEmployeePassword(
  userId: string,
): Promise<ResetPasswordResult> {
  const owner = await requireOwner();
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    return { status: "error", message: MESSAGES.notFound };
  }
  if (userId === owner.id) return { status: "error", message: MESSAGES.self };

  const admin = createAdminClient();
  if (!admin) return { status: "error", message: MESSAGES.notConfigured };

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, full_name, email, active")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) logFailure("read profile", profileError);
  if (!profile) return { status: "error", message: MESSAGES.notFound };
  if (!profile.active) return { status: "error", message: MESSAGES.inactive };

  const temporaryPassword = generateTemporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: temporaryPassword,
  });
  if (error) {
    logFailure("updateUserById password", error);
    return { status: "error", message: MESSAGES.generic };
  }

  // The password has already changed, so always show it. If the history
  // entry fails, say so instead of hiding the new password.
  const { error: recordError } = await admin.rpc(
    "admin_record_temporary_password",
    { p_target: userId, p_actor: owner.id },
  );
  if (recordError) logFailure("admin_record_temporary_password", recordError);

  revalidatePath(TEAM_PATH);
  return {
    status: "reset",
    fullName: profile.full_name,
    email: profile.email ?? "",
    temporaryPassword,
    warning: recordError
      ? "The password was reset, but the history entry couldn’t be saved."
      : undefined,
  };
}

export async function setEmployeeActive(
  userId: string,
  active: boolean,
): Promise<SetActiveResult> {
  const owner = await requireOwner();
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    return { status: "error", message: MESSAGES.notFound };
  }
  if (typeof active !== "boolean") {
    return { status: "error", message: MESSAGES.generic };
  }
  if (userId === owner.id) return { status: "error", message: MESSAGES.self };

  const admin = createAdminClient();
  if (!admin) return { status: "error", message: MESSAGES.notConfigured };

  if (!active) {
    // Update the database first: the app checks `active` on every request,
    // so access stops even if the sign-in block below fails.
    const { error } = await admin.rpc("admin_set_account_active", {
      p_target: userId,
      p_actor: owner.id,
      p_active: false,
    });
    if (error) {
      logFailure("admin_set_account_active false", error);
      if (error.message?.includes("last active owner")) {
        return { status: "error", message: MESSAGES.lastOwner };
      }
      return { status: "error", message: MESSAGES.generic };
    }

    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: DEACTIVATED_BAN,
    });
    revalidatePath(TEAM_PATH);
    if (banError) {
      logFailure("updateUserById ban", banError);
      return {
        status: "ok",
        warning:
          "The account is deactivated in Armour Ops, but Supabase didn’t confirm the sign-in block. The person still can’t use the app.",
      };
    }
    return { status: "ok" };
  }

  // Reactivate: lift the sign-in block first, then mark the profile active.
  const { error: unbanError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (unbanError) {
    logFailure("updateUserById unban", unbanError);
    return { status: "error", message: MESSAGES.generic };
  }

  const { error } = await admin.rpc("admin_set_account_active", {
    p_target: userId,
    p_actor: owner.id,
    p_active: true,
  });
  if (error) {
    logFailure("admin_set_account_active true", error);
    return { status: "error", message: MESSAGES.generic };
  }

  revalidatePath(TEAM_PATH);
  return { status: "ok" };
}
