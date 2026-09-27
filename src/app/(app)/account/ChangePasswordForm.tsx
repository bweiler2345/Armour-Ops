"use client";

import { useActionState } from "react";
import { AlertIcon, CheckIcon, SpinnerIcon } from "@/components/Icons";
import PasswordField from "@/components/PasswordField";
import { changePassword, type ChangePasswordState } from "@/lib/actions/account";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/account-validation";

const initialState: ChangePasswordState = {};

export default function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);
  const errors = state.fieldErrors ?? {};

  return (
    <section
      aria-labelledby="change-password"
      className="mt-6 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-6"
    >
      <h2 id="change-password" className="text-xl font-semibold text-white">
        Change Password
      </h2>
      <p className="mt-1 text-[15px] text-charcoal-300">
        Use at least {MIN_PASSWORD_LENGTH} characters.
      </p>

      {/* React clears the fields after each attempt, so passwords never linger. */}
      <form action={formAction} noValidate className="mt-5 flex flex-col gap-5">
        {state.status === "changed" && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4"
          >
            <CheckIcon className="mt-0.5 h-6 w-6 shrink-0 text-emerald-300" />
            <p className="text-[15px] font-medium text-emerald-100">
              Your password was changed.
            </p>
          </div>
        )}
        {state.error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4"
          >
            <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
            <p className="text-[15px] leading-relaxed font-medium text-red-100">
              {state.error}
            </p>
          </div>
        )}

        <PasswordField
          id="currentPassword"
          name="currentPassword"
          label="Current password"
          autoComplete="current-password"
          error={errors.currentPassword}
          disabled={pending}
        />
        <PasswordField
          id="newPassword"
          name="newPassword"
          label="New password"
          autoComplete="new-password"
          error={errors.newPassword}
          disabled={pending}
        />
        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirmPassword}
          disabled={pending}
        />

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="gold-gradient flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending && <SpinnerIcon className="h-6 w-6" />}
          {pending ? "Saving…" : "Change Password"}
        </button>
      </form>
    </section>
  );
}
