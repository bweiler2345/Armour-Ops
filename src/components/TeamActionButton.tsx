"use client";

import { useActionState } from "react";
import { AlertIcon, CheckIcon, SpinnerIcon, UsersIcon } from "@/components/Icons";
import { claimJob, joinJob, type TeamActionState } from "@/lib/actions/teams";

// Large Claim Job / Join Job button with loading, success, and error states.
export default function TeamActionButton({
  jobId,
  kind,
}: {
  jobId: string;
  kind: "claim" | "join";
}) {
  const action = kind === "claim" ? claimJob : joinJob;
  const [state, formAction, pending] = useActionState<TeamActionState>(
    action.bind(null, jobId),
    {},
  );
  const label = kind === "claim" ? "Claim Job" : "Join Job";
  const busy = kind === "claim" ? "Claiming…" : "Joining…";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4"
        >
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          <p className="text-[15px] leading-relaxed font-medium text-red-100">{state.error}</p>
        </div>
      )}
      {state.status === "done" ? (
        <p
          role="status"
          className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 text-[17px] font-semibold text-emerald-200"
        >
          <CheckIcon className="h-6 w-6" />
          {state.message}
        </p>
      ) : (
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="gold-gradient flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? <SpinnerIcon className="h-6 w-6" /> : <UsersIcon className="h-6 w-6" />}
          {pending ? busy : label}
        </button>
      )}
    </form>
  );
}
