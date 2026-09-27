"use client";

import { useState } from "react";
import { fieldClass } from "@/components/fieldClass";
import { PlusIcon } from "@/components/Icons";
import { DEFINITION_LIMITS, type InputDefinition, type StepDefinition } from "@/lib/steps/definition";

// The owner's step editor fields, shared by the Custom Step Library and
// one-time job steps. Lists are one item per line to stay quick on a phone.
// definitionFromForm() reads these field names.
export default function StepDefinitionFields({ initial }: { initial: StepDefinition }) {
  // Each entry keeps a stable key so removing one never reuses another's fields.
  const [inputs, setInputs] = useState<(InputDefinition & { k: number })[]>(() => initial.inputs.map((x, k) => ({ ...x, k })));
  const [proofType, setProofType] = useState(initial.proof.type);
  const [refCount, setRefCount] = useState(Math.max(initial.referenceLists.length, 0));
  const proof = initial.proof.type === "none" ? null : initial.proof;

  return (
    <div className="flex flex-col gap-5">
      <Field label="Step name" hint="For example: Sand Stairs, Grind Down Lip">
        <input name="title" defaultValue={initial.title} maxLength={DEFINITION_LIMITS.title} required className={fieldClass(false)} />
      </Field>
      <Field label="Goal" optional>
        <textarea name="goal" defaultValue={initial.goal} maxLength={DEFINITION_LIMITS.goal} rows={2} className={`${fieldClass(false)} py-3`} />
      </Field>
      <Field label="Instructions" hint="One numbered instruction per line">
        <textarea name="instructions" defaultValue={initial.instructions.join("\n")} rows={4} className={`${fieldClass(false)} py-3`} />
      </Field>

      {Array.from({ length: refCount }, (_, i) => (
        <fieldset key={i} className="rounded-2xl border border-charcoal-700 p-4">
          <legend className="px-1 text-[15px] font-semibold text-white">Reference list {i + 1} (not checked item by item)</legend>
          <input
            name={`refHeading${i}`}
            defaultValue={initial.referenceLists[i]?.heading ?? ""}
            placeholder="Heading, e.g. Tools"
            maxLength={80}
            className={`${fieldClass(false)} mt-2`}
          />
          <textarea
            name={`refItems${i}`}
            defaultValue={(initial.referenceLists[i]?.items ?? []).join("\n")}
            placeholder="One item per line"
            rows={3}
            className={`${fieldClass(false)} mt-2 py-3`}
          />
        </fieldset>
      ))}
      {refCount < DEFINITION_LIMITS.referenceLists && (
        <AddButton onClick={() => setRefCount(refCount + 1)}>Add Reference List</AddButton>
      )}

      <Field label="Required Final check items" hint="One per line. Every item must be checked.">
        <textarea
          name="checksRequired"
          defaultValue={initial.checks.filter((c) => c.required).map((c) => c.text).join("\n")}
          rows={4}
          className={`${fieldClass(false)} py-3`}
        />
      </Field>
      <Field label="Optional Final check items" optional>
        <textarea
          name="checksOptional"
          defaultValue={initial.checks.filter((c) => !c.required).map((c) => c.text).join("\n")}
          rows={2}
          className={`${fieldClass(false)} py-3`}
        />
      </Field>

      <input type="hidden" name="inputCount" value={inputs.length} />
      {inputs.map((input, i) => (
        <fieldset key={input.k} className="flex flex-col gap-3 rounded-2xl border border-charcoal-700 p-4">
          <legend className="px-1 text-[15px] font-semibold text-white">Entry {i + 1}</legend>
          <input name={`input${i}Label`} defaultValue={input.label} placeholder="Label, e.g. Treads sanded" maxLength={80} className={fieldClass(false)} />
          <select
            name={`input${i}Type`}
            defaultValue={input.type}
            onChange={(e) => {
              const type = e.target.value as InputDefinition["type"];
              setInputs((all) => all.map((x, j) => (j === i ? { ...x, type } : x)));
            }}
            className={`${fieldClass(false)} appearance-none`}
          >
            <option value="text">Written text</option>
            <option value="number">Number</option>
            <option value="single_select">Single-select</option>
          </select>
          <Check name={`input${i}Required`} defaultChecked={input.required}>Required</Check>
          {input.type === "number" && (
            <>
              <input name={`input${i}Unit`} defaultValue={input.unit ?? ""} placeholder="Unit (optional), e.g. boxes" maxLength={20} className={fieldClass(false)} />
              <input name={`input${i}Minimum`} defaultValue={input.minimum ?? ""} inputMode="decimal" placeholder="Minimum (optional)" className={fieldClass(false)} />
              <Check name={`input${i}Whole`} defaultChecked={input.wholeNumber}>Whole numbers only</Check>
            </>
          )}
          {input.type === "single_select" && (
            <textarea name={`input${i}Choices`} defaultValue={input.choices.join("\n")} placeholder="One choice per line (2 to 12)" rows={3} className={`${fieldClass(false)} py-3`} />
          )}
          <button
            type="button"
            onClick={() => setInputs((all) => all.filter((_, j) => j !== i))}
            className="min-h-12 rounded-xl border border-charcoal-600 text-[15px] font-semibold text-charcoal-300"
          >
            Remove Entry
          </button>
        </fieldset>
      ))}
      {inputs.length < DEFINITION_LIMITS.inputs && (
        <AddButton
          onClick={() =>
            setInputs([...inputs, { k: Math.max(-1, ...inputs.map((x) => x.k)) + 1, label: "", type: "text", required: true, unit: null, choices: [], wholeNumber: false, minimum: null }])
          }
        >
          Add Entry
        </AddButton>
      )}

      <fieldset>
        <legend className="mb-2 text-[15px] font-semibold text-white">Required proof</legend>
        <div className="grid grid-cols-3 gap-2">
          {(["none", "picture", "video"] as const).map((type) => (
            <label
              key={type}
              className={`flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border text-base font-semibold ${
                proofType === type ? "gold-gradient border-transparent text-charcoal-950" : "border-charcoal-700 bg-charcoal-900 text-white"
              }`}
            >
              <input type="radio" name="proofType" value={type} checked={proofType === type} onChange={() => setProofType(type)} className="sr-only" />
              {type === "none" ? "None" : type === "picture" ? "Picture" : "Video"}
            </label>
          ))}
        </div>
        {proofType !== "none" && (
          <div className="mt-3 flex flex-col gap-3">
            <input name="proofLabel" defaultValue={proof?.label ?? ""} placeholder="What to show, e.g. One picture of the finished stairs" maxLength={160} className={fieldClass(false)} />
            {proofType === "picture" ? (
              <>
                <label className="text-[15px] text-charcoal-300">
                  Minimum pictures
                  <input name="proofMinCount" type="number" min={1} max={20} defaultValue={proof?.minCount ?? 1} className={`${fieldClass(false)} mt-1`} />
                </label>
                <Check name="proofMultiple" defaultChecked={proof?.allowMultiple ?? false}>Allow more than one picture</Check>
              </>
            ) : (
              <p className="text-sm text-charcoal-400">One video, MOV or MP4, up to 3 minutes and 300 MB.</p>
            )}
          </div>
        )}
      </fieldset>

      <Field label="Confirmation statement" hint="The employee taps this before completing the step">
        <textarea name="confirmationText" defaultValue={initial.confirmationText} maxLength={DEFINITION_LIMITS.confirmation} rows={2} className={`${fieldClass(false)} py-3`} />
      </Field>
    </div>
  );
}

function Field({ label, hint, optional, children }: { label: string; hint?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[15px] font-semibold text-white">
        {label}
        {optional && <span className="ml-2 font-normal text-charcoal-400">optional</span>}
      </span>
      {hint && <span className="mb-1 block text-sm text-charcoal-400">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function Check({ name, defaultChecked, children }: { name: string; defaultChecked: boolean; children: React.ReactNode }) {
  return (
    <label className="flex min-h-12 items-center gap-3 text-[15px] text-white">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-6 w-6 accent-amber-400" />
      {children}
    </label>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-charcoal-600 text-base font-semibold text-gold-200"
    >
      <PlusIcon className="h-5 w-5" /> {children}
    </button>
  );
}
