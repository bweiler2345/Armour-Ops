"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Dialog from "@/components/Dialog";
import { AlertIcon, CheckIcon, SpinnerIcon } from "@/components/Icons";
import { completeCompletionItem } from "@/lib/actions/steps";

// A Completion Work item (Caulking Complete or Baseboard Complete): one
// large button with a confirmation, since a completed item can only be
// reopened by the owner.
export default function CompletionItemButton({
  jobId,
  stepId,
  title,
}: {
  jobId: string;
  stepId: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    start(async () => {
      const result = await completeCompletionItem(jobId, stepId).catch(() => ({
        ok: false as const,
        error: "Couldn’t reach the server. Check your connection and try again.",
      }));
      setOpen(false);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {error && (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] font-medium text-red-100">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-20 w-full items-center gap-4 rounded-2xl border border-gold-500/60 bg-charcoal-900 px-5 text-left transition active:scale-[0.99]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-charcoal-500" />
        <span className="text-lg font-semibold text-white">{title}</span>
      </button>

      {open && (
        <Dialog title={`Mark ${title}?`} onClose={() => setOpen(false)} locked={pending}>
          <p className="text-[15px] leading-relaxed text-charcoal-300">
            This records you and the time. It can’t be undone from this screen.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-600 bg-charcoal-800 text-base font-semibold text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="gold-gradient flex min-h-14 items-center justify-center gap-2 rounded-2xl text-base font-semibold text-charcoal-950 disabled:opacity-60"
            >
              {pending ? <SpinnerIcon className="h-5 w-5" /> : <CheckIcon className="h-5 w-5" />}
              {pending ? "Saving…" : "Mark Complete"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
