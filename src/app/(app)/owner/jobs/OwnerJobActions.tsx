"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Dialog from "@/components/Dialog";
import { AlertIcon, CheckIcon, KeyIcon, SpinnerIcon } from "@/components/Icons";
import { markJobComplete, markMilestoneInstalled, type OwnerActionResult } from "@/lib/actions/owner";

type Kind = "base_coat" | "top_coat" | "complete";

const COPY: Record<Kind, { button: string; title: string; body: string; confirm: string; busy: string }> = {
  base_coat: {
    button: "Mark Base Coat Installed",
    title: "Mark Base Coat Installed?",
    body: "This records you and the time, changes the job to Base Coat Installed, and opens Top-Coat Prep to the team. It can’t be undone here.",
    confirm: "Mark Installed",
    busy: "Marking…",
  },
  top_coat: {
    button: "Mark Top Coat Installed",
    title: "Mark Top Coat Installed?",
    body: "This records you and the time, changes the job to Top Coat Installed, and opens Completion Work to the team. It can’t be undone here.",
    confirm: "Mark Installed",
    busy: "Marking…",
  },
  complete: {
    button: "Mark Job Complete",
    title: "Mark this job Complete?",
    body: "Both installations and all Completion Work are done. The job becomes read only, and its pictures and videos are kept for five years. This can’t be undone here.",
    confirm: "Mark Complete",
    busy: "Completing…",
  },
};

// The owner's installation milestone and job completion buttons. Shown only
// when the action is valid; the database checks again, so a stale screen
// gets a plain explanation instead of a change.
export default function OwnerJobActions({ jobId, kind }: { jobId: string; kind: Kind }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<OwnerActionResult | null>(null);
  const copy = COPY[kind];

  function confirm() {
    start(async () => {
      const outcome = await (kind === "complete"
        ? markJobComplete(jobId)
        : markMilestoneInstalled(jobId, kind === "base_coat" ? "base_coat_installation" : "top_coat_installation")
      ).catch((): OwnerActionResult => ({
        ok: false,
        error: "Couldn’t reach the server. Check your connection and try again.",
      }));
      setResult(outcome);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`flex items-start gap-3 rounded-2xl border p-4 text-[15px] leading-relaxed font-medium ${
            result.ok
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
              : "border-red-400/40 bg-red-500/10 text-red-100"
          }`}
        >
          {result.ok ? <CheckIcon className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />}
          {result.ok ? result.message : result.error}
        </p>
      )}
      {!result?.ok && (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
          className="gold-gradient flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98]"
        >
          {kind === "complete" ? <CheckIcon className="h-6 w-6" /> : <KeyIcon className="h-6 w-6" />}
          {copy.button}
        </button>
      )}

      {open && (
        <Dialog title={copy.title} onClose={() => setOpen(false)} locked={pending}>
          <p className="text-[15px] leading-relaxed text-charcoal-300">{copy.body}</p>
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
              {pending && <SpinnerIcon className="h-5 w-5" />}
              {pending ? copy.busy : copy.confirm}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
