"use client";

import { useActionState, useRef, useState } from "react";
import Dialog from "@/components/Dialog";
import { fieldClass } from "@/components/fieldClass";
import { AlertIcon, SpinnerIcon } from "@/components/Icons";
import StepDefinitionFields from "@/components/StepDefinitionFields";
import type { CustomStepFormState } from "@/lib/actions/custom-steps";
import { EMPTY_DEFINITION } from "@/lib/steps/definition";

type Stage = { stageId: string; stageName: string; first: number; last: number; steps: { position: number; title: string }[] };

// Adds a custom step to a job: import from the library or write a one-time
// step (optionally saved to the library). Only safe stages and positions are
// offered; the database checks again. On a job in progress, a confirmation
// comes first.
export default function CustomStepForm({
  action,
  stages,
  library,
  inProgress,
}: {
  action: (state: CustomStepFormState, form: FormData) => Promise<CustomStepFormState>;
  stages: Stage[];
  library: { id: string; title: string; version: number }[];
  inProgress: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [source, setSource] = useState<"library" | "one_time">(library.length > 0 ? "library" : "one_time");
  const [stageId, setStageId] = useState(stages[0]?.stageId ?? "");
  const stage = stages.find((s) => s.stageId === stageId) ?? stages[0];
  const [position, setPosition] = useState(stage?.last ?? 1);
  const [confirming, setConfirming] = useState(false);
  const confirmed = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const positions = stage ? Array.from({ length: stage.last - stage.first + 1 }, (_, i) => stage.first + i) : [];

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(e) => {
        if (inProgress && !confirmed.current) {
          e.preventDefault();
          setConfirming(true);
        }
        confirmed.current = false;
      }}
      className="flex flex-col gap-6"
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-[15px] font-semibold text-white">Where it goes</legend>
        <select
          name="stageId"
          value={stageId}
          onChange={(e) => {
            const next = stages.find((s) => s.stageId === e.target.value);
            setStageId(e.target.value);
            setPosition(next?.last ?? 1);
          }}
          className={`${fieldClass(false)} appearance-none`}
        >
          {stages.map((s) => (
            <option key={s.stageId} value={s.stageId}>
              {s.stageName}
            </option>
          ))}
        </select>
        <select
          name="position"
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
          className={`${fieldClass(false)} appearance-none`}
        >
          {positions.map((p) => {
            const before = stage?.steps.find((s) => s.position === p);
            return (
              <option key={p} value={p}>
                {before ? `Step ${p}: before “${before.title}”` : `Step ${p}: at the end of the stage`}
              </option>
            );
          })}
        </select>
        {inProgress && (
          <p className="text-sm text-charcoal-400">Only places before work that hasn’t started are offered.</p>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[15px] font-semibold text-white">Step</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["library", "one_time"] as const).map((value) => (
            <label
              key={value}
              className={`flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border px-2 text-center text-base font-semibold ${
                source === value ? "gold-gradient border-transparent text-charcoal-950" : "border-charcoal-700 bg-charcoal-900 text-white"
              } ${value === "library" && library.length === 0 ? "opacity-40" : ""}`}
            >
              <input
                type="radio"
                name="source"
                value={value}
                checked={source === value}
                disabled={value === "library" && library.length === 0}
                onChange={() => setSource(value)}
                className="sr-only"
              />
              {value === "library" ? "From Library" : "One-Time Step"}
            </label>
          ))}
        </div>
      </fieldset>

      {source === "library" ? (
        <select name="libraryItemId" className={`${fieldClass(false)} appearance-none`} defaultValue={library[0]?.id}>
          {library.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} (version {item.version})
            </option>
          ))}
        </select>
      ) : (
        <>
          <StepDefinitionFields initial={EMPTY_DEFINITION} />
          <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-charcoal-700 px-4 text-[15px] text-white">
            <input type="checkbox" name="saveToLibrary" className="h-6 w-6 accent-amber-400" />
            Also save to the Custom Step Library for future jobs
          </label>
        </>
      )}

      {state.error && (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] font-medium text-red-100">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !stage}
        className="gold-gradient flex min-h-16 items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 disabled:opacity-60"
      >
        {pending && <SpinnerIcon className="h-6 w-6" />}
        {pending ? "Adding…" : "Add Step to Job"}
      </button>

      {confirming && (
        <Dialog title="Add a step to work in progress?" onClose={() => setConfirming(false)}>
          <p className="text-[15px] leading-relaxed text-charcoal-300">
            The team will need to complete it in order, and later steps wait for it. It’s recorded in the job’s history.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setConfirming(false)} className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-600 bg-charcoal-800 font-semibold text-white">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                confirmed.current = true;
                setConfirming(false);
                formRef.current?.requestSubmit();
              }}
              className="gold-gradient flex min-h-14 items-center justify-center rounded-2xl font-semibold text-charcoal-950"
            >
              Add Step
            </button>
          </div>
        </Dialog>
      )}
    </form>
  );
}
