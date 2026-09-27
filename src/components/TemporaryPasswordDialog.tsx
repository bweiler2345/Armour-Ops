"use client";

import { useState } from "react";
import Dialog from "@/components/Dialog";
import { AlertIcon, CheckIcon, CopyIcon } from "@/components/Icons";

// Shows a temporary password exactly once. The parent drops the password from
// memory when this closes; it cannot be fetched again.
export default function TemporaryPasswordDialog({
  title,
  fullName,
  email,
  password,
  warning,
  onDone,
}: {
  title: string;
  fullName: string;
  email: string;
  password: string;
  warning?: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <Dialog title={title} onClose={onDone}>
      <p className="text-[15px] leading-relaxed text-charcoal-300">
        Text this temporary password to{" "}
        <span className="font-semibold text-white">{fullName}</span>
        {email ? (
          <>
            {" "}
            to sign in as <span className="font-semibold break-all text-white">{email}</span>
          </>
        ) : null}
        . They should change it from their Account screen after signing in.
      </p>

      <p
        className="mt-5 rounded-2xl border border-gold-500/40 bg-charcoal-950 px-4 py-5 text-center font-mono text-2xl font-semibold tracking-wider break-all text-gold-300 select-all"
        aria-label="Temporary password"
      >
        {password}
      </p>

      <button
        type="button"
        onClick={copy}
        className="gold-gradient mt-4 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98]"
      >
        {copied === "copied" ? (
          <CheckIcon className="h-6 w-6" />
        ) : (
          <CopyIcon className="h-6 w-6" />
        )}
        {copied === "copied" ? "Copied" : "Copy Password"}
      </button>
      <p role="status" className="mt-2 min-h-5 text-center text-sm text-charcoal-400">
        {copied === "failed" && "Copy didn’t work here. Press and hold the password to copy it."}
      </p>

      <div className="mt-3 flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4">
        <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
        <p className="text-[15px] leading-relaxed font-medium text-red-100">
          This password will not be shown again. Copy it now. If it’s lost,
          reset the password to get a new one.
        </p>
      </div>

      {warning && (
        <p className="mt-3 text-[15px] leading-relaxed text-gold-300">{warning}</p>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-5 flex min-h-16 w-full items-center justify-center rounded-2xl border border-charcoal-700 bg-charcoal-800 text-lg font-semibold text-white transition hover:bg-charcoal-700 active:scale-[0.98]"
      >
        Done, I’ve saved it
      </button>
    </Dialog>
  );
}
