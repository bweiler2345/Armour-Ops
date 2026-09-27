"use client";

import { useActionState } from "react";
import { AlertIcon, SpinnerIcon } from "@/components/Icons";
import StepDefinitionFields from "@/components/StepDefinitionFields";
import type { LibraryFormState } from "@/lib/actions/library";
import type { StepDefinition } from "@/lib/steps/definition";

export default function LibraryItemForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: LibraryFormState, form: FormData) => Promise<LibraryFormState>;
  initial: StepDefinition;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <StepDefinitionFields initial={initial} />
      {state.error && (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] font-medium text-red-100">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="gold-gradient flex min-h-16 items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 disabled:opacity-60"
      >
        {pending && <SpinnerIcon className="h-6 w-6" />}
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
