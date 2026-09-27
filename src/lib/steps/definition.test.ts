import { describe, expect, it } from "vitest";
import { asDefinition, DEFAULT_CONFIRMATION, definitionFromForm, lines } from "./definition";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("the owner's step editor", () => {
  it("reads a full custom step from the form", () => {
    const result = definitionFromForm(
      form({
        title: " Sand Stairs ",
        goal: "Smooth every tread.",
        instructions: "Sand each tread\n\n  Vacuum the dust  ",
        refHeading0: "Tools",
        refItems0: "Hand sander\n60 grit",
        checksRequired: "Every tread sanded",
        checksOptional: "Nosing checked",
        inputCount: "2",
        input0Label: "Treads sanded",
        input0Type: "number",
        input0Required: "on",
        input0Unit: "treads",
        input0Minimum: "1",
        input0Whole: "on",
        input1Label: "Stair type",
        input1Type: "single_select",
        input1Choices: "Wood\nConcrete",
        proofType: "picture",
        proofLabel: "Finished stairs",
        proofMinCount: "2",
        confirmationText: "",
      }),
    );
    expect(result).toEqual({
      ok: true,
      definition: {
        title: "Sand Stairs",
        goal: "Smooth every tread.",
        instructions: ["Sand each tread", "Vacuum the dust"],
        referenceLists: [{ heading: "Tools", items: ["Hand sander", "60 grit"] }],
        checks: [
          { text: "Every tread sanded", required: true },
          { text: "Nosing checked", required: false },
        ],
        inputs: [
          { label: "Treads sanded", type: "number", required: true, unit: "treads", choices: [], wholeNumber: true, minimum: 1 },
          { label: "Stair type", type: "single_select", required: false, unit: null, choices: ["Wood", "Concrete"], wholeNumber: false, minimum: null },
        ],
        // More than one required picture always allows more than one.
        proof: { type: "picture", label: "Finished stairs", minCount: 2, allowMultiple: true },
        confirmationText: DEFAULT_CONFIRMATION,
      },
    });
  });

  it("keeps video proof to one video", () => {
    const result = definitionFromForm(
      form({ title: "Walkthrough", checksRequired: "Done", proofType: "video", proofLabel: "Walkthrough video", proofMinCount: "3", proofMultiple: "on" }),
    );
    expect(result.ok && result.definition.proof).toEqual({ type: "video", label: "Walkthrough video", minCount: 1, allowMultiple: false });
  });

  it("explains problems in plain language", () => {
    expect(definitionFromForm(form({ title: "", checksRequired: "x" }))).toEqual({
      ok: false,
      error: "Give the step a name of up to 80 characters.",
    });
    expect(definitionFromForm(form({ title: "Nothing to do" }))).toMatchObject({
      error: "Add at least one instruction or Final check item.",
    });
    expect(
      definitionFromForm(form({ title: "X", checksRequired: "x", inputCount: "1", input0Label: "Kind", input0Type: "single_select", input0Choices: "Only" })),
    ).toMatchObject({ error: "“Kind” needs 2 to 12 different choices of up to 60 characters." });
    expect(definitionFromForm(form({ title: "X", checksRequired: "x", proofType: "picture", proofLabel: "" }))).toMatchObject({
      error: "Describe the required proof in up to 160 characters.",
    });
  });

  it("reads stored library definitions back for editing", () => {
    expect(asDefinition({ title: "T", checks: [{ text: "a", required: true }] })).toMatchObject({
      title: "T",
      instructions: [],
      proof: { type: "none" },
      confirmationText: DEFAULT_CONFIRMATION,
    });
    expect(lines("a\r\n\r\n b ")).toEqual(["a", "b"]);
  });
});
