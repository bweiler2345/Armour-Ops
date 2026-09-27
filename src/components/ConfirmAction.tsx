"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Dialog from "@/components/Dialog";
import { AlertIcon, CheckIcon, SpinnerIcon } from "@/components/Icons";

type Outcome = { ok: boolean; error?: string; message?: string };

// A large button that asks for confirmation (and, when needed, a reason)
// before running an owner action. Shows the result in plain language.
export default function ConfirmAction({
  action,
  label,
  title,
  body,
  confirmLabel,
  busyLabel,
  tone = "secondary",
  reasonLabel,
}: {
  action: (reason: string) => Promise<Outcome>;
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  busyLabel: string;
  tone?: "primary" | "secondary" | "danger";
  // When set, a reason is required before confirming.
  reasonLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Outcome | null>(null);

  function confirm() {
    start(async () => {
      const outcome = await action(reason.trim()).catch(
        (): Outcome => ({ ok: false, error: "Couldn’t reach the server. Check your connection and try again." }),
      );
      setResult(outcome);
      if (outcome.ok) {
        setOpen(false);
        setReason("");
      }
      router.refresh();
    });
  }

  const buttonTone =
    tone === "primary"
      ? "gold-gradient text-charcoal-950 shadow-lg shadow-black/30"
      : tone === "danger"
        ? "border border-red-400/50 bg-charcoal-800 text-red-200"
        : "border border-gold-500/50 bg-charcoal-800 text-gold-200";

  return (
    <div className="flex flex-col gap-3">
      {result && !open && (result.error || result.message) && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`flex items-start gap-3 rounded-2xl border p-4 text-[15px] leading-relaxed font-medium ${
            result.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-red-400/40 bg-red-500/10 text-red-100"
          }`}
        >
          {result.ok ? <CheckIcon className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />}
          {result.ok ? result.message : result.error}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className={`flex min-h-16 w-full items-center justify-center rounded-2xl px-4 text-lg font-semibold transition active:scale-[0.98] ${buttonTone}`}
      >
        {label}
      </button>

      {open && (
        <Dialog title={title} onClose={() => setOpen(false)} locked={pending}>
          <p className="text-[15px] leading-relaxed text-charcoal-300">{body}</p>
          {reasonLabel && (
            <label className="mt-4 block">
              <span className="mb-2 block text-[15px] font-semibold text-white">{reasonLabel}</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                disabled={pending}
                className="block w-full rounded-2xl border border-charcoal-700 bg-charcoal-800 px-4 py-3 text-[17px] text-white outline-none focus:border-gold-400"
              />
            </label>
          )}
          {result && !result.ok && (
            <p role="alert" className="mt-3 text-[15px] text-red-200">
              {result.error}
            </p>
          )}
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
              disabled={pending || (reasonLabel !== undefined && reason.trim() === "")}
              className="gold-gradient flex min-h-14 items-center justify-center gap-2 rounded-2xl text-base font-semibold text-charcoal-950 disabled:opacity-50"
            >
              {pending && <SpinnerIcon className="h-5 w-5" />}
              {pending ? busyLabel : confirmLabel}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
