"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/Icons";
import { fieldClass } from "@/components/fieldClass";

export default function PasswordField({
  id,
  name,
  label,
  autoComplete,
  error,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  disabled?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[15px] font-semibold text-white">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${fieldClass(Boolean(error))} pr-16`}
        />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          disabled={disabled}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={shown}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-16 items-center justify-center rounded-r-2xl text-charcoal-300 transition hover:text-white active:scale-95 disabled:opacity-40"
        >
          {shown ? <EyeOffIcon className="h-7 w-7" /> : <EyeIcon className="h-7 w-7" />}
        </button>
      </div>
      {error && (
        <p id={errorId} className="mt-2 text-[15px] text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
