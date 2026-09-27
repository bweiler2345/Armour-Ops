"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { fieldClass } from "@/components/fieldClass";
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  LockIcon,
  SpinnerIcon,
} from "@/components/Icons";
import {
  acquireStepEdit,
  completeStep,
  releaseStepEdit,
  renewStepEdit,
  saveStepCheck,
  saveStepInput,
  loadStepLive,
  saveStepNotes,
  type StepResult,
} from "@/lib/actions/steps";
import { formatTime } from "@/lib/format";
import type { StepMediaItem } from "@/lib/media/types";
import { holdAfterRefusal, LEASE_MESSAGES, type LeaseRefusal } from "@/lib/steps/lease";
import { mergeLive, sameAnswers, type LocalStep } from "@/lib/steps/sync";
import { withTimeout } from "@/lib/timeout";
import {
  missingForCompletion,
  parseInputValue,
  type CheckItem,
  type ProofNeed,
  type StepInput,
} from "@/lib/steps/validation";
import ProofUploader from "./ProofUploader";

// While editing, renew this screen's lease this often (a lease lasts two
// minutes); a refusal, such as the owner ending the session, is noticed
// within this time. While not editing, check for others' saves this often.
// Both only run while the app is on screen.
const HEARTBEAT_MS = 8_000;
// Opening a step (getting a lease and the latest answers) gives up after
// this long, so the screen never waits forever on a lost request.
const OPEN_TIMEOUT_MS = 15_000;
const OPEN_FAILED = "This step didn’t open. Check your connection, then tap Try again.";
const NO_CONNECTION = "Couldn’t reach the server. Check your connection and try again.";

type Hold =
  | { status: "acquiring" }
  | { status: "held"; expiresAt: string }
  | { status: "refused"; reason: LeaseRefusal; message: string }
  | { status: "error"; message: string };

type Save = { status: "idle" | "saving" | "saved" } | { status: "error"; message: string };

export default function StepWorkspace({
  jobId,
  stepId,
  userId,
  checks,
  inputs,
  proofs,
  initialMedia,
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
  userId: string;
  checks: CheckItem[];
  inputs: StepInput[];
  proofs: ProofNeed[];
  initialMedia: StepMediaItem[];
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
  const [local, setLocal] = useState<LocalStep>(() => ({
    checked: new Set(initialChecked),
    answers: initialAnswers,
    notes: initialNotes,
    confirmed: false,
  }));
  const [holder, setHolder] = useState({ name: holderName, expiresAt: holderExpiresAt });
  // Proof files the database knows about, and whether this screen is still
  // uploading one.
  const [media, setMedia] = useState<StepMediaItem[]>(initialMedia);
  const [uploading, setUploading] = useState(false);
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [save, setSave] = useState<Save>({ status: "idle" });
  const [completing, startCompleting] = useTransition();
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The lease the database issued to this screen. Only an explicit acquire
  // sets it; any refusal clears it. Saves are sent with it and rejected by the
  // database without it.
  const lease = useRef<string | null>(null);
  // Changes on this screen the database hasn't confirmed yet. Refreshes never
  // overwrite these.
  const unsaved = useRef({ checks: new Set<string>(), inputs: new Set<string>(), notes: false });

  // Replace the screen's copy of the answers with the latest saved version.
  const sync = useCallback(
    async (keptHold: boolean) => {
      const live = await loadStepLive(stepId);
      if (!live) return false;
      if (live.state === "completed") {
        // A teammate finished it; the page re-renders as completed.
        router.refresh();
        return true;
      }
      setHolder({ name: live.holdHeldByName, expiresAt: live.holdExpiresAt });
      setMedia(live.media);
      const pending = {
        checks: new Set(unsaved.current.checks),
        inputs: new Set(unsaved.current.inputs),
        notes: unsaved.current.notes,
      };
      setLocal((current) => {
        const next = mergeLive(current, live, { unsaved: pending, keptHold });
        return sameAnswers(current, next) ? current : next;
      });
      return true;
    },
    [router, stepId],
  );

  // Stop editing on this screen. Typed text stays visible but nothing more is
  // saved until the employee asks for a new lease.
  const stopEditing = useCallback(
    (reason: LeaseRefusal) => {
      lease.current = null;
      setHold({ status: "refused", reason, message: LEASE_MESSAGES[reason] });
      void sync(false).catch(() => undefined);
    },
    [sync],
  );

  const handleFailure = useCallback(
    (result: Extract<StepResult, { ok: false }>) => {
      if (result.reason !== "error") stopEditing(result.reason);
      return result.error;
    },
    [stopEditing],
  );

  // Explicitly asks the database for a new lease, then loads the latest saved
  // answers before editing is allowed, so nobody edits from an out-of-date
  // screen.
  const acquire = useCallback(async () => {
    setHold({ status: "acquiring" });
    const request = acquireStepEdit(stepId);
    let result: StepResult;
    try {
      result = await withTimeout(request, OPEN_TIMEOUT_MS);
    } catch {
      lease.current = null;
      setHold({ status: "error", message: OPEN_FAILED });
      // If the lease arrives after all, give it back: this screen isn't using it.
      request.then(
        (late) => {
          if (late.ok && late.lease && lease.current !== late.lease) {
            void releaseStepEdit(stepId, late.lease).catch(() => undefined);
          }
        },
        () => undefined,
      );
      return;
    }
    if (!result.ok || !result.lease) {
      lease.current = null;
      if (!result.ok && result.reason !== "error") {
        setHold({ status: "refused", reason: result.reason, message: LEASE_MESSAGES[result.reason] });
        void sync(false).catch(() => undefined);
      } else {
        setHold({ status: "error", message: result.ok ? "Couldn’t start editing. Try again." : result.error });
      }
      return;
    }

    const loaded = await withTimeout(sync(false), OPEN_TIMEOUT_MS).catch(() => false);
    if (!loaded) {
      void releaseStepEdit(stepId, result.lease).catch(() => undefined);
      setHold({ status: "error", message: "Couldn’t load the latest answers. Try again." });
      return;
    }
    lease.current = result.lease;
    setHold({ status: "held", expiresAt: result.expiresAt ?? "" });
  }, [stepId, sync]);

  // Renews this screen's own lease. It never asks for a new one: if the
  // database refuses (for example, the owner ended the session), editing
  // stops here.
  const heartbeat = useCallback(async () => {
    const current = lease.current;
    if (!current) return;
    // A failed or lost renewal is tried again on the next beat; the lease
    // lasts two minutes.
    const result = await renewStepEdit(stepId, current).catch(() => null);
    if (!result || lease.current !== current) return;
    if (result.ok) setHold({ status: "held", expiresAt: result.expiresAt ?? "" });
    else if (result.reason !== "error") stopEditing(result.reason);
  }, [stepId, stopEditing]);

  // Ask for a lease when the screen opens. While editing, renew it; while not,
  // keep showing others' saved work. Catch up whenever the app comes back to
  // the foreground. Give the lease back on leave.
  useEffect(() => {
    // Asynchronous: state is set when the server answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void acquire();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (lease.current) void heartbeat();
      else void sync(false).catch(() => undefined);
    };
    const timer = window.setInterval(tick, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
      if (lease.current) void releaseStepEdit(stepId, lease.current).catch(() => undefined);
      lease.current = null;
    };
  }, [acquire, heartbeat, stepId, sync]);

  // After an upload finishes or a file is removed, show the saved list.
  const refreshMedia = useCallback(() => sync(lease.current !== null).catch(() => false), [sync]);

  const editable = hold.status === "held" && !done;
  const { checked, answers, notes, confirmed } = local;

  async function persist(run: () => Promise<StepResult>, onFail?: () => void) {
    setSave({ status: "saving" });
    const result = await run().catch(() => null);
    if (!result) {
      onFail?.();
      setSave({ status: "error", message: NO_CONNECTION });
      return false;
    }
    if (result.ok) {
      setSave({ status: "saved" });
      return true;
    }
    onFail?.();
    setSave({ status: "error", message: handleFailure(result) });
    return false;
  }

  function setChecked(id: string, on: boolean) {
    setLocal((current) => {
      const copy = new Set(current.checked);
      if (on) copy.add(id);
      else copy.delete(id);
      return { ...current, checked: copy };
    });
  }

  async function toggleCheck(id: string) {
    if (!editable) return;
    const next = !checked.has(id);
    unsaved.current.checks.add(id);
    setChecked(id, next);
    await persist(
      () => saveStepCheck(stepId, lease.current ?? "", id, next),
      () => setChecked(id, !next),
    );
    unsaved.current.checks.delete(id);
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
    if (!editable || (parsed.value ?? "") === (answers[input.id] ?? "")) {
      unsaved.current.inputs.delete(input.id);
      return;
    }
    const ok = await persist(() => saveStepInput(stepId, lease.current ?? "", input.id, raw));
    unsaved.current.inputs.delete(input.id);
    if (!ok) return;
    setLocal((current) => ({
      ...current,
      answers: { ...current.answers, [input.id]: parsed.value ?? "" },
    }));
  }

  async function commitNotes() {
    if (!editable || !unsaved.current.notes) return;
    const ok = await persist(() => saveStepNotes(stepId, lease.current ?? "", notes));
    if (ok) unsaved.current.notes = false;
  }

  const missing = missingForCompletion({
    checks,
    checked,
    inputs,
    answers,
    proofs,
    media,
    uploading,
    confirmed,
  });
  const needsProof = proofs.some(
    (p) => media.filter((m) => m.requirementId === p.id && m.status === "uploaded").length < p.minCount,
  );

  function complete() {
    setCompleteError(null);
    startCompleting(async () => {
      const result = await completeStep(jobId, stepId, lease.current ?? "", confirmed).catch(() => null);
      if (!result) {
        setCompleteError(NO_CONNECTION);
      } else if (result.ok) {
        lease.current = null;
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
        holderName={holder.name}
        holderExpiresAt={holder.expiresAt}
        onRetry={() => void acquire()}
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
              // Re-mount with the saved value whenever it changes elsewhere.
              key={`${input.id}|${answers[input.id] ?? ""}`}
              input={input}
              value={answers[input.id] ?? ""}
              error={inputErrors[input.id]}
              disabled={!editable}
              onEdit={() => unsaved.current.inputs.add(input.id)}
              onCommit={(raw) => void commitInput(input, raw)}
            />
          ))}
        </section>
      )}

      <ProofUploader
        jobId={jobId}
        stepId={stepId}
        userId={userId}
        proofs={proofs}
        media={media}
        editable={editable}
        lease={lease}
        onLeaseRefused={stopEditing}
        refresh={refreshMedia}
        onBusyChange={setUploading}
      />

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
          onChange={(e) => {
            unsaved.current.notes = true;
            const value = e.target.value;
            setLocal((current) => ({ ...current, notes: value }));
          }}
          onBlur={() => void commitNotes()}
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
          onClick={() => setLocal((current) => ({ ...current, confirmed: !current.confirmed }))}
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
          {completing ? <SpinnerIcon className="h-6 w-6" /> : needsProof ? <LockIcon className="h-6 w-6" /> : <CheckIcon className="h-6 w-6" />}
          {completing ? "Completing…" : needsProof ? "Needs Proof to Complete" : "Complete Step"}
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
      <div className="rounded-2xl border border-charcoal-700 bg-charcoal-900 p-4 text-[15px] text-charcoal-300">
        <p className="flex items-center gap-3">
          <SpinnerIcon className="h-5 w-5" /> Opening this step for editing…
        </p>
        {/* Appears only if this message is somehow still here after 20
            seconds, even if the page's scripts never started. */}
        <p className="reveal-late mt-2 text-gold-200">
          This is taking too long. Check your connection and reload the page.
        </p>
      </div>
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

  const refused = hold.status === "refused" ? holdAfterRefusal(hold.reason) : null;
  const text =
    hold.status === "refused" && hold.reason === "conflict" && holderName
      ? `${holderName} is editing this step${holderExpiresAt ? ` until about ${formatTime(holderExpiresAt)}` : ""}. You can edit once they leave it or their time runs out.`
      : hold.status === "refused" && hold.reason !== "conflict"
        ? `${hold.message} Nothing more is saved from this screen until you tap “Edit this step”.`
        : hold.message;

  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 rounded-2xl border p-4 ${
        hold.status === "refused" && hold.reason === "conflict"
          ? "border-gold-500/40 bg-gold-900/40"
          : "border-red-400/40 bg-red-500/10"
      }`}
    >
      <p className="flex items-start gap-3 text-[15px] leading-relaxed font-medium text-white">
        <LockIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold-300" />
        {text}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex min-h-14 items-center justify-center rounded-2xl border border-gold-500/50 bg-charcoal-800 text-base font-semibold text-gold-300 active:scale-[0.98]"
      >
        {refused?.action ?? "Try again"}
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

function InputField({
  input,
  value,
  error,
  disabled,
  onEdit,
  onCommit,
}: {
  input: StepInput;
  value: string;
  error?: string;
  disabled: boolean;
  onEdit: () => void;
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
          onChange={(e) => {
            onEdit();
            setDraft(e.target.value);
          }}
          onBlur={() => onCommit(draft)}
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
          onChange={(e) => {
            onEdit();
            setDraft(e.target.value);
          }}
          onBlur={() => onCommit(draft)}
          aria-invalid={error ? true : undefined}
          className={`${fieldClass(Boolean(error))} py-3`}
        />
      )}
      {error && <p className="mt-2 text-[15px] text-red-300">{error}</p>}
    </div>
  );
}
