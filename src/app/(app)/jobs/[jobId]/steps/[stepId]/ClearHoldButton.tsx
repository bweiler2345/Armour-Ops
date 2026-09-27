"use client";

import { useState, useTransition } from "react";
import { SpinnerIcon } from "@/components/Icons";
import { clearStepEdit } from "@/lib/actions/steps";

// Owner only: frees a step someone left open, for example on a lost phone.
export default function ClearHoldButton({ jobId, stepId }: { jobId: string; stepId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await clearStepEdit(jobId, stepId);
            setMessage(result.ok ? "Hold cleared. A teammate can edit this step now." : result.error);
          })
        }
        className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-gold-500/50 bg-charcoal-800 text-base font-semibold text-gold-300 active:scale-[0.98] disabled:opacity-60"
      >
        {pending && <SpinnerIcon className="h-5 w-5" />}
        {pending ? "Clearing…" : "Clear Edit Hold"}
      </button>
      {message && (
        <p role="status" className="text-[15px] text-charcoal-300">
          {message}
        </p>
      )}
    </div>
  );
}
