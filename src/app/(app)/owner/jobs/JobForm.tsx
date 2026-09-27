"use client";

import { useActionState } from "react";
import { fieldClass } from "@/components/fieldClass";
import { AlertIcon, SpinnerIcon } from "@/components/Icons";
import type { JobFormState } from "@/lib/actions/jobs";
import { JOB_LIMITS, type JobFormValues } from "@/lib/jobs/validation";

type Props = {
  action: (state: JobFormState, formData: FormData) => Promise<JobFormState>;
  initialValues: JobFormValues;
  submitLabel: string;
  pendingLabel: string;
};

export default function JobForm({ action, initialValues, submitLabel, pendingLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // After a failed attempt the server sends back what was entered.
  const values = state.values ?? initialValues;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4"
        >
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          <p className="text-[15px] leading-relaxed font-medium text-red-100">{state.error}</p>
        </div>
      )}

      <Field id="clientName" label="Client name" error={errors.clientName}>
        <input
          id="clientName"
          name="clientName"
          type="text"
          autoComplete="off"
          autoCapitalize="words"
          maxLength={JOB_LIMITS.clientName}
          defaultValue={values.clientName}
          disabled={pending}
          {...invalid("clientName", errors.clientName)}
          className={fieldClass(Boolean(errors.clientName))}
        />
      </Field>

      <Field id="address" label="Address" error={errors.address}>
        <input
          id="address"
          name="address"
          type="text"
          autoComplete="off"
          maxLength={JOB_LIMITS.address}
          defaultValue={values.address}
          disabled={pending}
          {...invalid("address", errors.address)}
          className={fieldClass(Boolean(errors.address))}
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="squareFeet" label="Square footage" error={errors.squareFeet}>
          <input
            id="squareFeet"
            name="squareFeet"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="650"
            defaultValue={values.squareFeet}
            disabled={pending}
            {...invalid("squareFeet", errors.squareFeet)}
            className={fieldClass(Boolean(errors.squareFeet))}
          />
        </Field>

        <Field id="scheduledDate" label="Scheduled date" error={errors.scheduledDate}>
          <input
            id="scheduledDate"
            name="scheduledDate"
            type="date"
            min={JOB_LIMITS.earliestDate}
            max={JOB_LIMITS.latestDate}
            defaultValue={values.scheduledDate}
            disabled={pending}
            {...invalid("scheduledDate", errors.scheduledDate)}
            className={`${fieldClass(Boolean(errors.scheduledDate))} [color-scheme:dark]`}
          />
        </Field>
      </div>

      <Field id="flakeColor" label="Flake color" error={errors.flakeColor}>
        <input
          id="flakeColor"
          name="flakeColor"
          type="text"
          autoComplete="off"
          autoCapitalize="words"
          maxLength={JOB_LIMITS.flakeColor}
          defaultValue={values.flakeColor}
          disabled={pending}
          {...invalid("flakeColor", errors.flakeColor)}
          className={fieldClass(Boolean(errors.flakeColor))}
        />
      </Field>

      <Field id="notes" label="Notes" hint="Optional" error={errors.notes}>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={JOB_LIMITS.notes}
          defaultValue={values.notes}
          disabled={pending}
          {...invalid("notes", errors.notes)}
          className={`${fieldClass(Boolean(errors.notes))} py-3`}
        />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-[15px] font-semibold text-white">Job options</legend>
        <Toggle
          name="caulkingRequired"
          label="Caulking"
          description="Adds “Caulking Complete” to Completion Work."
          defaultChecked={values.caulkingRequired}
          disabled={pending}
        />
        <Toggle
          name="baseboardRequired"
          label="Baseboard"
          description="Adds “Baseboard Complete” to Completion Work."
          defaultChecked={values.baseboardRequired}
          disabled={pending}
        />
        <Toggle
          name="allowEmployeesToJoin"
          label="Allow Employees to Join"
          description="Other employees can join without waiting for you."
          defaultChecked={values.allowEmployeesToJoin}
          disabled={pending}
        />
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="gold-gradient mt-2 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:opacity-60"
      >
        {pending && <SpinnerIcon className="h-6 w-6" />}
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}

function invalid(id: string, error: string | undefined) {
  return error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[15px] font-semibold text-white">
        {label}
        {hint && <span className="ml-2 font-normal text-charcoal-400">{hint}</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-2 text-[15px] text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function Toggle({
  name,
  label,
  description,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
  disabled: boolean;
}) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center gap-4 rounded-2xl border border-charcoal-700 bg-charcoal-800 px-4 py-3 transition has-[:checked]:border-gold-500/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold-400/40">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="h-7 w-7 shrink-0 accent-[#c9a96e]"
      />
      <span className="min-w-0">
        <span className="block text-[17px] font-semibold text-white">{label}</span>
        <span className="block text-sm text-charcoal-400">{description}</span>
      </span>
    </label>
  );
}
