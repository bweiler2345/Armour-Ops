"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { fieldClass } from "@/components/fieldClass";
import {
  AlertIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  LockIcon,
  SpinnerIcon,
} from "@/components/Icons";
import {
  acquireStepEdit,
  completeStep,
  releaseStepEdit,
  saveStepCheck,
  saveStepInput,
  saveStepNotes,
  type StepResult,
} from "@/lib/actions/steps";
import { formatTime } from "@/lib/format";
import {
  missingForCompletion,
  parseInputValue,
  type CheckItem,
  type StepInput,
} from "@/lib/steps/validation";

// Renews the edit hold while the screen is open (the hold lasts two minutes).
const RENEW_EVERY_MS = 30_000;

type Hold =
  | { status: "acquiring" }
  | { status: "held"; expiresAt: string }
  | { status: "conflict"; message: string }
  | { status: "expired"; message: string }
  | { status: "error"; message: string };

type Save = { status: "idle" | "saving" | "saved" } | { status: "error"; message: string };

export default function StepWorkspace({
  jobId,
  stepId,
  checks,
  inputs,
  proofType,
  proofs,
  confirmationText,
  initialChecked,
  initialAnswers,
  initialNotes,
  holderName,
  holderExpiresAt,
  nextStepHref,
}: {
  jobId: string;
  stepId: string;
  checks: CheckItem[];
  inputs: StepInput[];
  proofType: "none" | "picture" | "video";
  proofs: { id: string; label: string; mediaType: "picture" | "video" }[];
  confirmationText: string;
  initialChecked: string[];
  initialAnswers: Record<string, string>;
  initialNotes: string;
  holderName: string | null;
  holderExpiresAt: string | null;
  nextStepHref: string | null;
}) {
  const router = useRouter();
  const [hold, setHold] = useState<Hold>({ status: "acquiring" });
  const [checked, setChecked] = useState(() => new Set(initialChecked));
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState(initialNotes);
  const [save, setSave] = useState<Save>({ status: "idle" });
  const [confirmed, setConfirmed] = useState(false);
  const [completing, startCompleting] = useTransition();
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const holding = useRef(false);

  const handleFailure = useCallback((result: Extract<StepResult, { ok: false }>) => {
    if (result.reason === "conflict") {
      holding.current = false;
      setHold({ status: "conflict", message: result.error });
    } else if (result.reason === "expired") {
      holding.current = false;
      setHold({ status: "expired", message: result.error });
    }
    return result.error;
  }, []);

  const acquire = useCallback(async () => {
    const result = await acquireStepEdit(stepId);
    if (result.ok) {
      holding.current = true;
      setHold({ status: "held", expiresAt: result.expiresAt ?? "" });
    } else if (result.reason === "conflict") {
      holding.current = false;
      setHold({ status: "conflict", message: result.error });
    } else {
      holding.current = false;
      setHold({ status: "error", message: result.error });
    }
  }, [stepId]);

  // Take the hold when the screen opens, renew it while open, and give it
  // back on leave so a teammate can continue right away.
  useEffect(() => {
    // Asynchronous: the hold state is set when the server answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void acquire();
    const renew = window.setInterval(() => {
      if (holding.current) void acquire();
    }, RENEW_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && holding.current) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(renew);
      document.removeEventListener("visibilitychange", onVisible);
      if (holding.current) void releaseStepEdit(stepId);
      holding.current = false;
    };
  }, [acquire, stepId]);

  const editable = hold.status === "held" && !done;

  async function persist(run: () => Promise<StepResult>, onFail?: () => void) {
    setSave({ status: "saving" });
    const result = await run();
    if (result.ok) {
      setSave({ status: "saved" });
      return true;
    }
    onFail?.();
    setSave({ status: "error", message: handleFailure(result) });
    return false;
  }

  function toggleCheck(id: string) {
    if (!editable) return;
    const next = !checked.has(id);
    setChecked((current) => {
      const copy = new Set(current);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
    void persist(
      () => saveStepCheck(stepId, id, next),
      () =>
        setChecked((current) => {
          const copy = new Set(current);
          if (next) copy.delete(id);
          else copy.add(id);
          return copy;
        }),
    );
  }

  async function commitInput(input: StepInput, raw: string) {
    const parsed = parseInputValue(input, raw);
    if (!parsed.ok) {
      setInputErrors((e) => ({ ...e, [input.id]: parsed.error }));
      return;
    }
    setInputErrors((e) => {
      const copy = { ...e };
      delete copy[input.id];
      return copy;
    });
    if (!editable) return;
    const ok = await persist(() => saveStepInput(stepId, input.id, raw));
    if (!ok) return;
    setAnswers((a) => ({ ...a, [input.id]: parsed.value ?? "" }));
  }

  const missing = missingForCompletion({
    checks,
    checked,
    inputs,
    answers,
    proofType,
    confirmed,
  });

  function complete() {
    setCompleteError(null);
    startCompleting(async () => {
      const result = await completeStep(jobId, stepId, confirmed);
      if (result.ok) {
        holding.current = false;
        setDone(true);
        router.refresh();
      } else {
        setCompleteError(handleFailure(result));
      }
    });
  }

  if (done) {
    return (
      <section className="mt-6 flex flex-col gap-4">
        <p
          role="status"
          className="flex items-center gap-3 rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-5 text-lg font-semibold text-emerald-100"
        >
          <CheckIcon className="h-7 w-7 shrink-0" />
          Step complete. Nice work.
        </p>
        <Link
          href={nextStepHref ?? `/jobs/${jobId}`}
          className="gold-gradient flex min-h-16 items-center justify-center gap-2 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 active:scale-[0.98]"
        >
          {nextStepHref ? "Next Step" : "Back to Job"}
          <ChevronRightIcon className="h-6 w-6" />
        </Link>
      </section>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <HoldBanner
        hold={hold}
        holderName={holderName}
        holderExpiresAt={holderExpiresAt}
        onRetry={() => {
          setHold({ status: "acquiring" });
          void acquire();
        }}
      />

      {checks.length > 0 && (
        <section aria-labelledby="final-check">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="final-check" className="text-lg font-semibold text-white">
              Final check
            </h2>
            <span className="text-sm font-semibold text-gold-300 tabular-nums">
              {checks.filter((c) => checked.has(c.id)).length} of {checks.length}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {checks.map((item) => {
              const on = checked.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!editable}
                    onClick={() => toggleCheck(item.id)}
                    className={`flex min-h-16 w-full items-center gap-4 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99] disabled:opacity-60 ${
                      on
                        ? "border-gold-500/60 bg-gold-900/40"
                        : "border-charcoal-700 bg-charcoal-900"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 ${
                        on ? "gold-gradient border-transparent text-charcoal-950" : "border-charcoal-500"
                      }`}
                    >
                      {on && <CheckIcon className="h-6 w-6" />}
                    </span>
                    <span className="text-[16px] leading-snug text-white">
                      {item.text}
                      {!item.required && (
                        <span className="ml-2 text-sm text-charcoal-400">(optional)</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {inputs.length > 0 && (
        <section aria-labelledby="entries" className="flex flex-col gap-5">
          <h2 id="entries" className="text-lg font-semibold text-white">
            Required entries
          </h2>
          {inputs.map((input) => (
            <InputField
              key={input.id}
              input={input}
              value={answers[input.id] ?? ""}
              error={inputErrors[input.id]}
              disabled={!editable}
              onCommit={(raw) => void commitInput(input, raw)}
            />
          ))}
        </section>
      )}

      <ProofCard proofType={proofType} proofs={proofs} />

      <section aria-labelledby="notes-label">
        <label id="notes-label" htmlFor="notes" className="mb-2 block text-lg font-semibold text-white">
          Notes <span className="text-sm font-normal text-charcoal-400">optional</span>
        </label>
        <textarea
          id="notes"
          rows={3}
          value={notes}
          maxLength={2000}
          disabled={!editable}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (editable && notes.trim() !== initialNotes.trim()) {
              void persist(() => saveStepNotes(stepId, notes));
            }
          }}
          className={`${fieldClass(false)} py-3`}
          placeholder="Anything the owner or your team should know"
        />
      </section>

      <SaveStatus save={save} />

      <section aria-labelledby="confirm" className="flex flex-col gap-3">
        <h2 id="confirm" className="text-lg font-semibold text-white">
          Confirm
        </h2>
        <button
          type="button"
          role="checkbox"
          aria-checked={confirmed}
          disabled={!editable}
          onClick={() => setConfirmed((c) => !c)}
          className={`flex min-h-16 w-full items-start gap-4 rounded-2xl border px-4 py-4 text-left transition disabled:opacity-60 ${
            confirmed ? "border-gold-500/60 bg-gold-900/40" : "border-charcoal-700 bg-charcoal-900"
          }`}
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 ${
              confirmed ? "gold-gradient border-transparent text-charcoal-950" : "border-charcoal-500"
            }`}
          >
            {confirmed && <CheckIcon className="h-6 w-6" />}
          </span>
          <span className="text-[16px] leading-snug font-medium text-white">“{confirmationText}”</span>
        </button>

        {missing.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-2xl bg-charcoal-900 px-4 py-3 text-sm text-charcoal-300">
            {missing.map((m) => (
              <li key={m}>• {m}</li>
            ))}
          </ul>
        )}

        {completeError && (
          <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] font-medium text-red-100">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            {completeError}
          </p>
        )}

        <button
          type="button"
          onClick={complete}
          disabled={!editable || completing || missing.length > 0}
          className="gold-gradient flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {completing ? <SpinnerIcon className="h-6 w-6" /> : proofType === "none" ? <CheckIcon className="h-6 w-6" /> : <LockIcon className="h-6 w-6" />}
          {completing ? "Completing…" : proofType === "none" ? "Complete Step" : "Needs Proof to Complete"}
        </button>
      </section>
    </div>
  );
}

function HoldBanner({
  hold,
  holderName,
  holderExpiresAt,
  onRetry,
}: {
  hold: Hold;
  holderName: string | null;
  holderExpiresAt: string | null;
  onRetry: () => void;
}) {
  if (hold.status === "acquiring") {
    return (
      <p className="flex items-center gap-3 rounded-2xl border border-charcoal-700 bg-charcoal-900 p-4 text-[15px] text-charcoal-300">
        <SpinnerIcon className="h-5 w-5" /> Opening this step for editing…
      </p>
    );
  }
  if (hold.status === "held") {
    return (
      <p className="flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] font-medium text-emerald-100">
        <CheckIcon className="h-5 w-5 shrink-0" />
        You’re editing this step. Teammates see it as in use while this screen is open.
      </p>
    );
  }
  const who =
    hold.status === "conflict" && holderName
      ? `${holderName} is editing this step${holderExpiresAt ? ` until about ${formatTime(holderExpiresAt)}` : ""}.`
      : hold.message;
  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 rounded-2xl border p-4 ${
        hold.status === "conflict" ? "border-gold-500/40 bg-gold-900/40" : "border-red-400/40 bg-red-500/10"
      }`}
    >
      <p className="flex items-start gap-3 text-[15px] leading-relaxed font-medium text-white">
        <LockIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold-300" />
        {who}
        {hold.status === "conflict" && " You can edit once they leave it or their time runs out."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex min-h-14 items-center justify-center rounded-2xl border border-gold-500/50 bg-charcoal-800 text-base font-semibold text-gold-300 active:scale-[0.98]"
      >
        {hold.status === "expired" ? "Edit this step" : "Try again"}
      </button>
    </div>
  );
}

function SaveStatus({ save }: { save: Save }) {
  if (save.status === "idle") return null;
  if (save.status === "error") {
    return (
      <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-[15px] text-red-100">
        {save.message}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-charcoal-400">
      {save.status === "saving" ? <SpinnerIcon className="h-4 w-4" /> : <CheckIcon className="h-4 w-4 text-emerald-300" />}
      {save.status === "saving" ? "Saving…" : "Saved"}
    </p>
  );
}

function ProofCard({
  proofType,
  proofs,
}: {
  proofType: "none" | "picture" | "video";
  proofs: { id: string; label: string; mediaType: "picture" | "video" }[];
}) {
  if (proofType === "none") return null;
  return (
    <section
      aria-labelledby="proof"
      className="rounded-3xl border border-gold-500/40 bg-charcoal-900 p-5"
    >
      <h2 id="proof" className="flex items-center gap-2 text-lg font-semibold text-white">
        <CameraIcon className="h-6 w-6 text-gold-300" />
        Required {proofType === "video" ? "video" : "pictures"}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {proofs.map((p) => (
          <li key={p.id} className="rounded-2xl bg-charcoal-800 px-4 py-3 text-[15px] text-white">
            {p.label}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm leading-relaxed text-gold-300">
        Uploading arrives in the next update. Until then this step can’t be completed, but you can
        still work through the Final check.
      </p>
    </section>
  );
}

function InputField({
  input,
  value,
  error,
  disabled,
  onCommit,
}: {
  input: StepInput;
  value: string;
  error?: string;
  disabled: boolean;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const label = (
    <span className="mb-2 block text-[15px] font-semibold text-white">
      {input.label}
      {!input.required && <span className="ml-2 font-normal text-charcoal-400">optional</span>}
    </span>
  );

  if (input.type === "single_select") {
    return (
      <fieldset>
        <legend>{label}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(input.choices ?? []).map((choice) => {
            const on = value === choice;
            return (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onCommit(choice)}
                className={`flex min-h-16 items-center justify-center rounded-2xl border text-lg font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
                  on
                    ? "gold-gradient border-transparent text-charcoal-950"
                    : "border-charcoal-700 bg-charcoal-900 text-white"
                }`}
              >
                {choice}
              </button>
            );
          })}
        </div>
        {error && <p className="mt-2 text-[15px] text-red-300">{error}</p>}
      </fieldset>
    );
  }

  const id = `input-${input.id}`;
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {input.type === "number" ? (
        <input
          id={id}
          type="text"
          inputMode={input.wholeNumber ? "numeric" : "decimal"}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft.trim() !== value && onCommit(draft)}
          aria-invalid={error ? true : undefined}
          className={fieldClass(Boolean(error))}
        />
      ) : (
        <textarea
          id={id}
          rows={3}
          value={draft}
          maxLength={2000}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft.trim() !== value && onCommit(draft)}
          aria-invalid={error ? true : undefined}
          className={`${fieldClass(Boolean(error))} py-3`}
        />
      )}
      {error && <p className="mt-2 text-[15px] text-red-300">{error}</p>}
    </div>
  );
}
