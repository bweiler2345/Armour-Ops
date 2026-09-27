import { describe, expect, it } from "vitest";
import { APPROVED_WORKFLOW } from "@/lib/workflow/approved-workflow";
import { milestoneState } from "@/lib/jobs/status";
import { missingForCompletion, parseInputValue, type StepInput } from "./validation";

// Build the Collect Excess Flake inputs from the approved workflow itself.
const flake = APPROVED_WORKFLOW.stages
  .flatMap((s) => s.steps)
  .find((s) => s.key === "collect_excess_flake")!;
const [boxes, extra]: StepInput[] = flake.inputs.map((input) => ({
  id: input.key,
  label: input.label,
  type: input.type,
  required: input.required,
  choices: input.choices,
  wholeNumber: input.wholeNumber,
  minimum: input.minimum,
}));

const text: StepInput = {
  id: "t",
  label: "Written entry",
  type: "text",
  required: true,
  choices: null,
  wholeNumber: false,
  minimum: null,
};

describe("structured input validation", () => {
  it("accepts Full boxes recovered as a whole number of 0 or more", () => {
    expect(parseInputValue(boxes, "0")).toEqual({ ok: true, value: "0" });
    expect(parseInputValue(boxes, " 12 ")).toEqual({ ok: true, value: "12" });
    expect(parseInputValue(boxes, "-1")).toMatchObject({ ok: false });
    const decimal = parseInputValue(boxes, "2.5");
    expect(!decimal.ok && decimal.error).toMatch(/whole number/);
    expect(parseInputValue(boxes, "two")).toMatchObject({ ok: false });
  });

  it("accepts only the approved Additional flake choices", () => {
    for (const choice of ["None", "¼ box", "½ box", "¾ box"]) {
      expect(parseInputValue(extra, choice)).toEqual({ ok: true, value: choice });
    }
    expect(parseInputValue(extra, "1/4 box").ok).toBe(false);
    expect(parseInputValue(extra, "none").ok).toBe(false);
  });

  it("treats blank as not entered and limits written entries", () => {
    expect(parseInputValue(text, "   ")).toEqual({ ok: true, value: null });
    expect(parseInputValue(text, "x".repeat(2001)).ok).toBe(false);
    expect(parseInputValue(text, "Stain near the drain.")).toEqual({ ok: true, value: "Stain near the drain." });
  });
});

describe("what blocks Complete Step", () => {
  const checks = [
    { id: "a", text: "A", required: true },
    { id: "b", text: "B", required: true },
    { id: "c", text: "C", required: false },
  ];

  it("lists unchecked required checks, missing entries, and the confirmation", () => {
    expect(
      missingForCompletion({
        checks,
        checked: new Set(["a"]),
        inputs: [boxes, extra],
        answers: { [boxes.id]: "2" },
        proofs: [],
        media: [],
        uploading: false,
        confirmed: false,
      }),
    ).toEqual(["Check the last Final check item.", "Fill in Additional flake.", "Tap the confirmation statement."]);
  });

  it("keeps optional checks optional", () => {
    expect(
      missingForCompletion({
        checks,
        checked: new Set(["a", "b"]),
        inputs: [],
        answers: {},
        proofs: [],
        media: [],
        uploading: false,
        confirmed: true,
      }),
    ).toEqual([]);
  });

  const photos = { id: "p1", label: "Room photos", mediaType: "picture" as const, minCount: 3, allowMultiple: true };
  const video = { id: "v1", label: "Walkthrough video", mediaType: "video" as const, minCount: 1, allowMultiple: false };
  const base = { checks: [], checked: new Set<string>(), inputs: [], answers: {}, confirmed: true };

  it("requires verified proof for every requirement", () => {
    expect(missingForCompletion({ ...base, proofs: [photos, video], media: [], uploading: false })).toEqual([
      "Add proof: Room photos",
      "Add proof: Walkthrough video",
    ]);
  });

  it("counts only uploaded files toward multiple-picture requirements", () => {
    const media = [
      { requirementId: "p1", status: "uploaded" as const },
      { requirementId: "p1", status: "uploaded" as const },
      { requirementId: "p1", status: "failed" as const },
      { requirementId: "v1", status: "uploaded" as const },
    ];
    expect(missingForCompletion({ ...base, proofs: [photos, video], media, uploading: false })).toEqual([
      "Add proof: Room photos",
    ]);
    media.push({ requirementId: "p1", status: "uploaded" });
    expect(missingForCompletion({ ...base, proofs: [photos, video], media, uploading: false })).toEqual([]);
  });

  it("blocks completion while an upload is still going", () => {
    const media = [{ requirementId: "v1", status: "uploaded" as const }];
    expect(missingForCompletion({ ...base, proofs: [video], media, uploading: true })).toEqual([
      "Wait for every upload to finish.",
    ]);
    expect(
      missingForCompletion({
        ...base,
        proofs: [video],
        media: [...media, { requirementId: "v1", status: "pending" as const }],
        uploading: false,
      }),
    ).toEqual(["Wait for every upload to finish."]);
  });

  it("reports an invalid saved entry", () => {
    expect(
      missingForCompletion({
        checks: [],
        checked: new Set(),
        inputs: [boxes],
        answers: { [boxes.id]: "1.5" },
        proofs: [],
        media: [],
        uploading: false,
        confirmed: true,
      }),
    ).toEqual(["Enter a whole number for Full boxes recovered."]);
  });
});

describe("owner milestone states", () => {
  it("follow the job status", () => {
    expect(milestoneState("initial_prep_in_progress", "base_coat_installation")).toBe("upcoming");
    expect(milestoneState("waiting_for_base_coat_installation", "base_coat_installation")).toBe("waiting");
    expect(milestoneState("base_coat_installed", "base_coat_installation")).toBe("installed");
    expect(milestoneState("base_coat_installed", "top_coat_installation")).toBe("upcoming");
    expect(milestoneState("waiting_for_top_coat_installation", "top_coat_installation")).toBe("waiting");
    expect(milestoneState("complete", "top_coat_installation")).toBe("installed");
  });
});
