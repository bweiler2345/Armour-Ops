import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPROVED_WORKFLOW, type WorkflowStep } from "./approved-workflow";
import { generateWorkflowSeedSql } from "./seed-sql";
import { parseWorkflowSpec, type SpecNode, type SpecStep } from "./spec-parser";

const SPEC = readFileSync("docs/PRODUCT_SPEC.md", "utf8");
const SEED_MIGRATION = "supabase/migrations/20260927020100_seed_approved_workflow_v1.sql";
const stages = APPROVED_WORKFLOW.stages;
const stage = (key: string) => {
  const found = stages.find((s) => s.key === key);
  if (!found) throw new Error(`Missing stage ${key}`);
  return found;
};
const allSteps = stages.flatMap((s) => s.steps);

describe("workflow order and counts", () => {
  it("has exactly five stages in the approved order", () => {
    expect(stages.map((s) => [s.key, s.name, s.kind])).toEqual([
      ["initial_prep", "Initial Prep", "employee_stage"],
      ["base_coat_installation", "Base-Coat Installation", "owner_milestone"],
      ["top_coat_prep", "Top-Coat Prep", "employee_stage"],
      ["top_coat_installation", "Top-Coat Installation", "owner_milestone"],
      ["completion_work", "Completion Work", "completion_work"],
    ]);
  });

  it("has the exact steps in the exact order", () => {
    expect(stages.map((s) => s.steps.map((step) => step.title))).toEqual([
      [
        "Grind Floor",
        "Vacuum Floor",
        "Patchwork",
        "Cut Garage-Door Lines",
        "Hand-Grind Edges, Patches, and Missed Areas",
        "Clean Joints",
        "Clean Edges and Corners",
        "Final Vacuum",
        "Set Up for Base-Coat Installation",
      ],
      [],
      [
        "Collect Excess Flake",
        "Scrape Floor",
        "Clean Joints",
        "Vacuum Floor",
        "Set Up for Top-Coat Installation",
      ],
      [],
      ["Caulking Complete", "Baseboard Complete"],
    ]);
  });

  it("has 16 steps: 14 preparation steps and 2 completion items", () => {
    expect(allSteps).toHaveLength(16);
    expect(allSteps.filter((s) => s.kind === "standard")).toHaveLength(14);
    expect(allSteps.filter((s) => s.kind === "completion_item")).toHaveLength(2);
  });

  it("uses unique keys within each stage", () => {
    for (const s of stages) {
      const keys = s.steps.map((step) => step.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("is version 1 of a stable workflow key", () => {
    expect(APPROVED_WORKFLOW.key).toBe("armour-floors-standard");
    expect(APPROVED_WORKFLOW.version).toBe(1);
    expect(APPROVED_WORKFLOW.source).toBe("docs/PRODUCT_SPEC.md");
  });
});

describe("checks", () => {
  const standardSteps = allSteps.filter((s) => s.kind === "standard");

  it("gives every preparation step a required Final check", () => {
    for (const step of standardSteps) {
      const checklists = step.blocks.filter((b) => b.kind === "checklist");
      expect(checklists.map((b) => b.heading), step.title).toEqual(["Final check"]);
      expect(checklists[0].items.length, step.title).toBeGreaterThan(0);
    }
  });

  it("makes only Final check items required (the seed marks checklist items required)", () => {
    const seed = readFileSync(SEED_MIGRATION, "utf8");
    expect(seed).not.toMatch(/'(ordered_list|reference_list)', \d+, '.*', true\)/);
    expect(seed).not.toMatch(/'checklist', \d+, '.*', false\)/);
  });

  it("keeps instructions as numbered lists", () => {
    for (const step of standardSteps) {
      expect(step.blocks[0].heading, step.title).toMatch(/^(Instructions|Choose the setup location)$/);
      expect(step.blocks[0].kind, step.title).toBe("ordered_list");
    }
  });
});

describe("setup reference lists", () => {
  const setupSteps = [
    stage("initial_prep").steps.find((s) => s.key === "set_up_for_base_coat_installation")!,
    stage("top_coat_prep").steps.find((s) => s.key === "set_up_for_top_coat_installation")!,
  ];

  it("keeps the mixing-station and inside-work-area lists as reference-only", () => {
    for (const step of setupSteps) {
      const byHeading = Object.fromEntries(step.blocks.map((b) => [b.heading, b.kind]));
      expect(byHeading["Mixing-station checklist"]).toBe("reference_list");
      expect(byHeading["Inside-work-area checklist"]).toBe("reference_list");
      expect(byHeading["Choose the setup location"]).toBe("ordered_list");
      expect(byHeading["Final check"]).toBe("checklist");
    }
  });

  it("keeps “Second weenie roller when needed” as reference text", () => {
    for (const step of setupSteps) {
      const inside = step.blocks.find((b) => b.heading === "Inside-work-area checklist")!;
      expect(inside.kind).toBe("reference_list");
      expect(inside.items).toContain("Second weenie roller when needed");
    }
  });

  it("keeps the base-coat final action as an instruction, not a checkbox", () => {
    const finalAction = setupSteps[0].blocks.find((b) => b.heading === "Final action")!;
    expect(finalAction.kind).toBe("reference_list");
    expect(finalAction.items).toEqual(["Tape off and protect every drain."]);
  });

  it("only these two steps have reference lists", () => {
    const withReference = allSteps.filter((s) => s.blocks.some((b) => b.kind === "reference_list"));
    expect(withReference.map((s) => s.key)).toEqual(setupSteps.map((s) => s.key));
  });
});

describe("proof", () => {
  it("requires the approved proof type for every step", () => {
    expect(stages.map((s) => s.steps.map((step) => step.proofType))).toEqual([
      ["video", "video", "picture", "picture", "video", "picture", "none", "video", "picture"],
      [],
      ["none", "none", "none", "video", "picture"],
      [],
      ["none", "none"],
    ]);
  });

  it("matches each proof requirement to its step's proof type", () => {
    for (const step of allSteps) {
      if (step.proofType === "none") {
        expect(step.proofRequirements, step.title).toEqual([]);
      } else {
        expect(step.proofRequirements.length, step.title).toBeGreaterThan(0);
        for (const proof of step.proofRequirements) expect(proof.mediaType).toBe(step.proofType);
      }
    }
  });

  it("allows several files only where the spec asks for “pictures” or “each”", () => {
    const multiple = allSteps.flatMap((s) =>
      s.proofRequirements.filter((p) => p.allowMultiple).map((p) => p.label),
    );
    expect(multiple).toEqual([
      "Upload clear pictures showing the completed patchwork.",
      "Upload one clear picture of each completed garage-door line.",
      "Upload clear pictures showing the cleaned joints.",
      "One picture showing each protected drain.",
    ]);
  });

  it("lists three pictures for base-coat setup and two for top-coat setup", () => {
    const labels = (step: WorkflowStep | undefined) => step?.proofRequirements.map((p) => p.label);
    expect(labels(stage("initial_prep").steps.at(-1))).toEqual([
      "One picture of the mixing station.",
      "One picture of the tools staged inside.",
      "One picture showing each protected drain.",
    ]);
    expect(labels(stage("top_coat_prep").steps.at(-1))).toEqual([
      "One picture of the mixing station.",
      "One picture of the tools staged inside.",
    ]);
  });
});

describe("structured inputs", () => {
  it("gives Collect Excess Flake exactly two required inputs", () => {
    const step = stage("top_coat_prep").steps[0];
    expect(step.title).toBe("Collect Excess Flake");
    expect(step.proofType).toBe("none");
    expect(step.inputs).toEqual([
      {
        key: "full_boxes_recovered",
        label: "Full boxes recovered",
        type: "number",
        required: true,
        unit: null,
        choices: null,
        wholeNumber: true,
        minimum: 0,
      },
      {
        key: "additional_flake",
        label: "Additional flake",
        type: "single_select",
        required: true,
        unit: null,
        choices: ["None", "¼ box", "½ box", "¾ box"],
        wholeNumber: false,
        minimum: null,
      },
    ]);
  });

  it("has no other structured inputs", () => {
    const withInputs = allSteps.filter((s) => s.inputs.length > 0).map((s) => s.key);
    expect(withInputs).toEqual(["collect_excess_flake"]);
  });
});

describe("owner installation milestones", () => {
  const milestones = stages.filter((s) => s.kind === "owner_milestone");

  it("are owner-only stages with no employee steps", () => {
    expect(milestones.map((m) => m.key)).toEqual(["base_coat_installation", "top_coat_installation"]);
    for (const milestone of milestones) expect(milestone.steps).toEqual([]);
  });

  it("use the standardized installation actions and statuses", () => {
    expect(milestones.map((m) => m.ownerAction)).toEqual([
      {
        label: "Mark Base Coat Installed",
        waitingStatusLabel: "Waiting for Base-Coat Installation",
        completedStatusLabel: "Base Coat Installed",
      },
      {
        label: "Mark Top Coat Installed",
        waitingStatusLabel: "Waiting for Top-Coat Installation",
        completedStatusLabel: "Top Coat Installed",
      },
    ]);
  });

  it("follow Initial Prep and Top-Coat Prep respectively", () => {
    const keys = stages.map((s) => s.key);
    expect(keys.indexOf("base_coat_installation")).toBe(keys.indexOf("initial_prep") + 1);
    expect(keys.indexOf("top_coat_installation")).toBe(keys.indexOf("top_coat_prep") + 1);
  });

  it("never use the old pour wording anywhere", () => {
    expect(JSON.stringify(APPROVED_WORKFLOW)).not.toMatch(/\bpour/i);
  });
});

describe("completion work, caulking, and baseboard", () => {
  const completion = stage("completion_work");

  it("is the last stage, right after Top-Coat Installation", () => {
    expect(stages.at(-1)).toBe(completion);
    expect(stages.at(-2)?.key).toBe("top_coat_installation");
  });

  it("contains caulking then baseboard as simple items tied to the job toggles", () => {
    expect(completion.steps.map((s) => [s.title, s.kind, s.appliesWhen])).toEqual([
      ["Caulking Complete", "completion_item", "caulking_required"],
      ["Baseboard Complete", "completion_item", "baseboard_required"],
    ]);
  });

  it("adds no instructions, sub-checklists, inputs, proof, or confirmation", () => {
    for (const step of completion.steps) {
      expect(step.goal).toBeNull();
      expect(step.note).toBeNull();
      expect(step.blocks).toEqual([]);
      expect(step.inputs).toEqual([]);
      expect(step.proofType).toBe("none");
      expect(step.proofText).toBeNull();
      expect(step.confirmationText).toBeNull();
    }
  });

  it("leaves Mark Job Complete to the owner", () => {
    expect(completion.ownerAction?.label).toBe("Mark Job Complete");
  });

  it("puts caulking and baseboard nowhere else", () => {
    const elsewhere = stages
      .filter((s) => s.key !== "completion_work")
      .flatMap((s) => s.steps)
      .filter((s) => s.appliesWhen !== null || /caulking|baseboard/i.test(s.title));
    expect(elsewhere).toEqual([]);
  });
});

describe("matches docs/PRODUCT_SPEC.md word for word", () => {
  const spec = parseWorkflowSpec(SPEC);
  const paragraph = (nodes: SpecNode[]) => {
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("paragraph");
    return (nodes[0] as { text: string }).text;
  };
  const list = (nodes: SpecNode[]) => {
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("list");
    return nodes[0] as { ordered: boolean; items: string[] };
  };

  it("has the same stages in the same order", () => {
    expect(spec.map((s) => s.heading)).toEqual([
      "Stage 1: Initial Prep",
      "Owner Milestone: Base-Coat Installation",
      "Stage 2: Top-Coat Prep",
      "Owner Milestone: Top-Coat Installation",
      "Completion Work",
    ]);
    expect(spec.map((s) => s.heading.replace(/^Stage \d+: |^Owner Milestone: /, ""))).toEqual(
      stages.map((s) => s.name),
    );
  });

  function compareStep(specStep: SpecStep, step: WorkflowStep) {
    expect(specStep.title).toBe(step.title);

    const quote = specStep.intro.find((n) => n.type === "quote");
    expect(quote ? (quote as { text: string }).text : null).toBe(step.note);

    const remaining = [...specStep.subsections];
    const take = (heading: string) => {
      const index = remaining.findIndex((s) => s.heading === heading);
      expect(index, `${step.title}: ${heading}`).toBeGreaterThanOrEqual(0);
      return remaining.splice(index, 1)[0].nodes;
    };

    expect(paragraph(take("Goal"))).toBe(step.goal);
    expect(paragraph(take("Confirmation"))).toBe(`“${step.confirmationText}”`);

    const proof = take("Required proof");
    if (proof[0]?.type === "list") {
      expect(step.proofText).toBeNull();
      expect(list(proof).items).toEqual(step.proofRequirements.map((p) => p.label));
    } else {
      const text = paragraph(proof);
      expect(text).toBe(step.proofText);
      expect(step.proofRequirements.map((p) => p.label)).toEqual(
        step.proofType === "none" ? [] : [text],
      );
    }

    const inputIndex = remaining.findIndex((s) => s.heading === "Required structured inputs");
    if (step.inputs.length > 0) {
      const nodes = remaining.splice(inputIndex, 1)[0].nodes;
      expect(nodes[0]).toEqual({
        type: "paragraph",
        text: "This step uses two required structured inputs:",
      });
      expect(step.inputs).toHaveLength(2);
      const describe = (input: WorkflowStep["inputs"][number]) => {
        if (input.type === "number") return `${input.label}: number.`;
        const choices = input.choices ?? [];
        return `${input.label}: single-select with ${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}.`;
      };
      expect(nodes[1]).toEqual({ type: "list", ordered: false, items: step.inputs.map(describe) });
    } else {
      expect(inputIndex).toBe(-1);
    }

    // Everything left is a content block, in the spec's order.
    expect(
      remaining.map((s) => {
        const l = list(s.nodes);
        return { heading: s.heading, ordered: l.ordered, items: l.items };
      }),
    ).toEqual(
      step.blocks.map((b) => ({
        heading: b.heading,
        ordered: b.kind === "ordered_list",
        items: b.items,
      })),
    );
  }

  it("has every preparation step exactly as written", () => {
    for (const key of ["initial_prep", "top_coat_prep"]) {
      const specStage = spec[stages.findIndex((s) => s.key === key)];
      const steps = stage(key).steps;
      expect(specStage.steps.map((s) => s.number)).toEqual(steps.map((_, i) => i + 1));
      specStage.steps.forEach((specStep, i) => compareStep(specStep, steps[i]));
    }
  });

  it("has both owner milestones exactly as written", () => {
    for (const key of ["base_coat_installation", "top_coat_installation"]) {
      const specStage = spec[stages.findIndex((s) => s.key === key)];
      const milestone = stage(key);
      expect(specStage.steps).toEqual([]);
      expect(specStage.intro).toEqual([
        { type: "paragraph", text: milestone.description },
        { type: "paragraph", text: milestone.rulesHeading },
        { type: "list", ordered: true, items: milestone.rules },
      ]);
    }
  });

  it("has Completion Work exactly as written", () => {
    const specStage = spec.at(-1)!;
    const completion = stage("completion_work");
    expect(specStage.intro).toEqual([
      { type: "paragraph", text: completion.description },
      { type: "paragraph", text: completion.rulesHeading },
      { type: "list", ordered: false, items: completion.rules },
    ]);
    for (const step of completion.steps) {
      expect(completion.rules.some((rule) => rule.includes(`“${step.title}”`))).toBe(true);
    }
    // The spec writes “Mark Job Complete.” with the period inside the quotes.
    expect(
      completion.rules.includes(`Only the owner can select “${completion.ownerAction?.label}.”`),
    ).toBe(true);
  });
});

describe("seed migration", () => {
  it("matches the generator output exactly (run `npm run workflow:seed` after changes)", () => {
    const committed = readFileSync(SEED_MIGRATION, "utf8").replaceAll("\r\n", "\n");
    expect(committed).toBe(generateWorkflowSeedSql(APPROVED_WORKFLOW));
  });

  it("is deterministic", () => {
    expect(generateWorkflowSeedSql(APPROVED_WORKFLOW)).toBe(
      generateWorkflowSeedSql(APPROVED_WORKFLOW),
    );
  });
});
