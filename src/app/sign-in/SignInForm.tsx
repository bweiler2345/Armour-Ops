"use client";

import { useActionState } from "react";
import { fieldClass } from "@/components/fieldClass";
import { AlertIcon, SpinnerIcon } from "@/components/Icons";
import PasswordField from "@/components/PasswordField";
import { signIn } from "@/lib/auth/actions";
import type { SignInState } from "@/lib/auth/sign-in";

const initialState: SignInState = {};

export default function SignInForm({
  next,
  disabled,
}: {
  next: string;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const emailError = state.fieldErrors?.email;
  const passwordError = state.fieldErrors?.password;

  return (
    <form action={formAction} noValidate className="mt-6 flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />

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

      <div>
        <label
          htmlFor="email"
          className="mb-2 block text-[15px] font-semibold text-white"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          // React resets the form after each attempt; this restores the email.
          defaultValue={state.email}
          disabled={disabled || pending}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "email-error" : undefined}
          className={fieldClass(Boolean(emailError))}
        />
        {emailError && (
          <p id="email-error" className="mt-2 text-[15px] text-red-300">
            {emailError}
          </p>
        )}
      </div>

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
        error={passwordError}
        disabled={disabled || pending}
      />

      <button
        type="submit"
        disabled={disabled || pending}
        aria-busy={pending}
        className="gold-gradient mt-2 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending && <SpinnerIcon className="h-6 w-6" />}
        {pending ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}

