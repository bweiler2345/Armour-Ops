"use client";

import { useActionState } from "react";
import { AlertIcon, SpinnerIcon } from "@/components/Icons";
import { changeJobStatus, type JobStatusState } from "@/lib/actions/jobs";

// Make Available (Scheduled → Available to Claim) and Return to Scheduled
// (Available to Claim → Scheduled). Both are reversible, so no confirmation.
export default function JobStatusControls({
  jobId,
  change,
}: {
  jobId: string;
  change: "make_available" | "return_to_scheduled";
}) {
  const [state, formAction, pending] = useActionState<JobStatusState>(
    changeJobStatus.bind(null, jobId, change),
    {},
  );
  const primary = change === "make_available";

  return (
    <form action={formAction}>
      {state.error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4"
        >
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          <p className="text-[15px] leading-relaxed font-medium text-red-100">{state.error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className={`flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
          primary
            ? "gold-gradient text-charcoal-950 shadow-lg shadow-black/30"
            : "border border-charcoal-700 bg-charcoal-800 text-white hover:bg-charcoal-700"
        }`}
      >
        {pending && <SpinnerIcon className="h-6 w-6" />}
        {primary
          ? pending
            ? "Making available…"
            : "Make Available"
          : pending
            ? "Returning…"
            : "Return to Scheduled"}
      </button>
    </form>
  );
}
