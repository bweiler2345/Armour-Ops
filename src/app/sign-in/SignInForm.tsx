"use client";

import { useActionState, useState } from "react";
import {
  AlertIcon,
  EyeIcon,
  EyeOffIcon,
  SpinnerIcon,
} from "@/components/Icons";
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
  const [showPassword, setShowPassword] = useState(false);
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

      <div>
        <label
          htmlFor="password"
          className="mb-2 block text-[15px] font-semibold text-white"
        >
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={disabled || pending}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "password-error" : undefined}
            className={`${fieldClass(Boolean(passwordError))} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            disabled={disabled}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="password"
            className="absolute inset-y-0 right-0 flex w-16 items-center justify-center rounded-r-2xl text-charcoal-300 transition hover:text-white active:scale-95 disabled:opacity-40"
          >
            {showPassword ? (
              <EyeOffIcon className="h-7 w-7" />
            ) : (
              <EyeIcon className="h-7 w-7" />
            )}
          </button>
        </div>
        {passwordError && (
          <p id="password-error" className="mt-2 text-[15px] text-red-300">
            {passwordError}
          </p>
        )}
      </div>

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

function fieldClass(invalid: boolean) {
  // 17px text keeps iOS Safari from zooming in when a field is focused.
  return `block min-h-16 w-full rounded-2xl border bg-charcoal-800 px-4 text-[17px] text-white placeholder:text-charcoal-400 transition outline-none focus:ring-2 disabled:opacity-60 ${
    invalid
      ? "border-red-400/70 focus:border-red-400 focus:ring-red-400/30"
      : "border-charcoal-700 focus:border-gold-400 focus:ring-gold-400/30"
  }`;
}
