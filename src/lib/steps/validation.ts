// Mirrors the database's step rules (parse_step_input and complete_step in
// supabase/migrations/..._step_work.sql) for instant feedback on the phone.
// The database stays the authority: every save and completion is checked
// there again.

export type StepInput = {
  id: string;
  label: string;
  type: "text" | "number" | "single_select";
  required: boolean;
  choices: readonly string[] | null;
  wholeNumber: boolean;
  minimum: number | null;
};

export type ParsedInput =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export const MAX_TEXT_LENGTH = 2000;

export function parseInputValue(input: StepInput, raw: string): ParsedInput {
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };

  if (input.type === "text") {
    if (value.length > MAX_TEXT_LENGTH) {
      return { ok: false, error: `${input.label} must be 2,000 characters or fewer.` };
    }
    return { ok: true, value };
  }

  if (input.type === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      return { ok: false, error: `Enter a number for ${input.label}.` };
    }
    const number = Number(value);
    if (input.wholeNumber && !Number.isInteger(number)) {
      return { ok: false, error: `Enter a whole number for ${input.label}.` };
    }
    const minimum = input.minimum ?? 0;
    if (number < minimum) {
      return { ok: false, error: `${input.label} must be ${minimum} or more.` };
    }
    return { ok: true, value };
  }

  if (!(input.choices ?? []).includes(value)) {
    return { ok: false, error: `Choose one of the listed options for ${input.label}.` };
  }
  return { ok: true, value };
}

export type CheckItem = { id: string; text: string; required: boolean };

// What still stands between the employee and Complete Step, in screen order.
export function missingForCompletion(input: {
  checks: readonly CheckItem[];
  checked: ReadonlySet<string>;
  inputs: readonly StepInput[];
  answers: Readonly<Record<string, string>>;
  proofType: "none" | "picture" | "video";
  confirmed: boolean;
}): string[] {
  const missing: string[] = [];
  const unchecked = input.checks.filter((c) => c.required && !input.checked.has(c.id));
  if (unchecked.length > 0) {
    missing.push(
      unchecked.length === 1
        ? "Check the last Final check item."
        : `Check ${unchecked.length} more Final check items.`,
    );
  }
  for (const field of input.inputs) {
    const raw = input.answers[field.id] ?? "";
    const parsed = parseInputValue(field, raw);
    if (!parsed.ok) missing.push(parsed.error);
    else if (field.required && parsed.value === null) missing.push(`Fill in ${field.label}.`);
  }
  if (input.proofType !== "none") {
    missing.push(
      `Add the required ${input.proofType === "video" ? "video" : "pictures"}. Uploading arrives in the next update.`,
    );
  }
  if (!input.confirmed) missing.push("Tap the confirmation statement.");
  return missing;
}
