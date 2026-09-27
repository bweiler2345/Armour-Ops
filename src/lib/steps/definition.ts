// A custom step (one-time or in the Custom Step Library), as the owner's
// step editor sends it. The database checks every definition again
// (public.step_definition_problem); these checks give instant feedback.

export type InputDefinition = {
  label: string;
  type: "text" | "number" | "single_select";
  required: boolean;
  unit: string | null;
  choices: string[];
  wholeNumber: boolean;
  minimum: number | null;
};

export type StepDefinition = {
  title: string;
  goal: string;
  instructions: string[];
  referenceLists: { heading: string; items: string[] }[];
  checks: { text: string; required: boolean }[];
  inputs: InputDefinition[];
  proof:
    | { type: "none" }
    | { type: "picture" | "video"; label: string; minCount: number; allowMultiple: boolean };
  confirmationText: string;
};

export const DEFINITION_LIMITS = {
  title: 80,
  goal: 500,
  instructions: 20,
  instructionLength: 300,
  referenceLists: 3,
  referenceItems: 30,
  checks: 30,
  inputs: 10,
  choices: 12,
  proofLabel: 160,
  maxPictures: 20,
  confirmation: 300,
} as const;

export const DEFAULT_CONFIRMATION = "I confirm this step is complete and matches the instructions.";

export const EMPTY_DEFINITION: StepDefinition = {
  title: "",
  goal: "",
  instructions: [],
  referenceLists: [],
  checks: [],
  inputs: [],
  proof: { type: "none" },
  confirmationText: DEFAULT_CONFIRMATION,
};

// One entry per non-blank line.
export function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export function definitionFromForm(form: FormData): { ok: true; definition: StepDefinition } | { ok: false; error: string } {
  const referenceLists: StepDefinition["referenceLists"] = [];
  for (let i = 0; i < DEFINITION_LIMITS.referenceLists; i++) {
    const heading = text(form, `refHeading${i}`);
    const items = lines(form.get(`refItems${i}`));
    if (heading || items.length) referenceLists.push({ heading, items });
  }

  const inputs: InputDefinition[] = [];
  const count = Math.min(Number(form.get("inputCount")) || 0, DEFINITION_LIMITS.inputs);
  for (let i = 0; i < count; i++) {
    const label = text(form, `input${i}Label`);
    if (!label) continue;
    const type = text(form, `input${i}Type`);
    const minimum = text(form, `input${i}Minimum`);
    inputs.push({
      label,
      type: type === "number" || type === "single_select" ? type : "text",
      required: form.get(`input${i}Required`) === "on",
      unit: text(form, `input${i}Unit`) || null,
      choices: type === "single_select" ? lines(form.get(`input${i}Choices`)) : [],
      wholeNumber: type === "number" && form.get(`input${i}Whole`) === "on",
      minimum: type === "number" && minimum !== "" && Number.isFinite(Number(minimum)) ? Number(minimum) : null,
    });
  }

  const proofType = text(form, "proofType");
  const minCount = Math.round(Number(form.get("proofMinCount")) || 1);
  const proof: StepDefinition["proof"] =
    proofType === "picture" || proofType === "video"
      ? {
          type: proofType,
          label: text(form, "proofLabel"),
          minCount: proofType === "video" ? 1 : minCount,
          allowMultiple: proofType === "picture" && (form.get("proofMultiple") === "on" || minCount > 1),
        }
      : { type: "none" };

  const definition: StepDefinition = {
    title: text(form, "title"),
    goal: text(form, "goal"),
    instructions: lines(form.get("instructions")),
    referenceLists,
    checks: [
      ...lines(form.get("checksRequired")).map((t) => ({ text: t, required: true })),
      ...lines(form.get("checksOptional")).map((t) => ({ text: t, required: false })),
    ],
    inputs,
    proof,
    confirmationText: text(form, "confirmationText") || DEFAULT_CONFIRMATION,
  };
  const problem = definitionProblem(definition);
  return problem ? { ok: false, error: problem } : { ok: true, definition };
}

export function definitionProblem(d: StepDefinition): string | null {
  const L = DEFINITION_LIMITS;
  if (!d.title || d.title.length > L.title) return "Give the step a name of up to 80 characters.";
  if (d.goal.length > L.goal) return "Keep the goal to 500 characters or fewer.";
  if (!d.confirmationText || d.confirmationText.length > L.confirmation) {
    return "Add a confirmation statement of up to 300 characters.";
  }
  if (d.instructions.length > L.instructions) return "Use 20 instructions or fewer.";
  if (d.instructions.some((i) => i.length > L.instructionLength)) return "Each instruction must be 1 to 300 characters.";
  for (const list of d.referenceLists) {
    if (!list.heading || list.heading.length > 80) return "Each reference list needs a heading of up to 80 characters.";
    if (list.items.length < 1 || list.items.length > L.referenceItems || list.items.some((i) => i.length > 200)) {
      return "Each reference list needs 1 to 30 items of up to 200 characters.";
    }
  }
  if (d.checks.length > L.checks) return "Use 30 Final check items or fewer.";
  if (d.checks.some((c) => c.text.length > 300)) return "Each Final check item must be 1 to 300 characters.";
  if (d.instructions.length === 0 && d.checks.length === 0) return "Add at least one instruction or Final check item.";

  const labels = new Set<string>();
  for (const input of d.inputs) {
    if (input.label.length > 80) return "Each entry needs a label of up to 80 characters.";
    if (labels.has(input.label.toLowerCase())) return "Each entry needs a different label.";
    labels.add(input.label.toLowerCase());
    if ((input.unit ?? "").length > 20) return "Keep each unit to 20 characters or fewer.";
    if (input.type === "single_select") {
      const unique = new Set(input.choices.map((c) => c.toLowerCase()));
      if (input.choices.length < 2 || input.choices.length > L.choices || unique.size !== input.choices.length || input.choices.some((c) => c.length > 60)) {
        return `“${input.label}” needs 2 to 12 different choices of up to 60 characters.`;
      }
    }
  }

  if (d.proof.type !== "none") {
    if (!d.proof.label || d.proof.label.length > L.proofLabel) return "Describe the required proof in up to 160 characters.";
    if (d.proof.type === "picture" && (d.proof.minCount < 1 || d.proof.minCount > L.maxPictures)) {
      return "Require 1 to 20 pictures.";
    }
  }
  return null;
}

// Reads a stored definition (from the library) back into the editor's shape.
export function asDefinition(value: unknown): StepDefinition {
  const d = (value ?? {}) as Partial<StepDefinition>;
  return {
    ...EMPTY_DEFINITION,
    ...d,
    instructions: d.instructions ?? [],
    referenceLists: d.referenceLists ?? [],
    checks: d.checks ?? [],
    inputs: (d.inputs ?? []).map((i) => ({ ...i, choices: i.choices ?? [], unit: i.unit ?? null, minimum: i.minimum ?? null })),
    proof: d.proof ?? { type: "none" },
    goal: d.goal ?? "",
  };
}
