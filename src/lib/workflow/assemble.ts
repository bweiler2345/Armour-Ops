import type {
  BlockKind,
  JobOption,
  ProofType,
  StageKind,
  StepKind,
  WorkflowTemplate,
} from "./approved-workflow";

// Rebuilds a workflow template from its database rows. Used to show the
// stored workflow, and (Phase 3) as the source when a job snapshots it.

export type WorkflowRows = {
  template: {
    id: string;
    key: string;
    name: string;
    version: number;
    source: string;
  };
  stages: {
    id: string;
    template_id: string;
    position: number;
    key: string;
    name: string;
    kind: StageKind;
    description: string | null;
    rules_heading: string | null;
    rules: string[];
    owner_action_label: string | null;
    waiting_status_label: string | null;
    completed_status_label: string | null;
  }[];
  steps: {
    id: string;
    stage_id: string;
    position: number;
    key: string;
    title: string;
    kind: StepKind;
    note: string | null;
    goal: string | null;
    proof_type: ProofType;
    proof_text: string | null;
    confirmation_text: string | null;
    applies_when: JobOption | null;
  }[];
  blocks: { id: string; step_id: string; position: number; heading: string; kind: BlockKind }[];
  items: { block_id: string; position: number; text: string }[];
  inputs: {
    step_id: string;
    position: number;
    key: string;
    label: string;
    input_type: "text" | "number" | "single_select";
    required: boolean;
    unit: string | null;
    choices: string[] | null;
    whole_number: boolean;
    minimum: number | string | null;
  }[];
  proofs: {
    step_id: string;
    position: number;
    label: string;
    media_type: "picture" | "video";
    min_count: number;
    allow_multiple: boolean;
  }[];
};

const byPosition = <T extends { position: number }>(rows: T[]) =>
  [...rows].sort((a, b) => a.position - b.position);

export function assembleWorkflow(rows: WorkflowRows): WorkflowTemplate {
  const stages = byPosition(rows.stages.filter((s) => s.template_id === rows.template.id));

  return {
    key: rows.template.key,
    name: rows.template.name,
    version: rows.template.version,
    source: rows.template.source,
    stages: stages.map((stage) => ({
      key: stage.key,
      name: stage.name,
      kind: stage.kind,
      description: stage.description,
      rulesHeading: stage.rules_heading,
      rules: stage.rules,
      ownerAction: stage.owner_action_label
        ? {
            label: stage.owner_action_label,
            waitingStatusLabel: stage.waiting_status_label,
            completedStatusLabel: stage.completed_status_label,
          }
        : null,
      steps: byPosition(rows.steps.filter((s) => s.stage_id === stage.id)).map((step) => ({
        key: step.key,
        title: step.title,
        kind: step.kind,
        note: step.note,
        goal: step.goal,
        blocks: byPosition(rows.blocks.filter((b) => b.step_id === step.id)).map((block) => ({
          heading: block.heading,
          kind: block.kind,
          items: byPosition(rows.items.filter((i) => i.block_id === block.id)).map((i) => i.text),
        })),
        inputs: byPosition(rows.inputs.filter((i) => i.step_id === step.id)).map((input) => ({
          key: input.key,
          label: input.label,
          type: input.input_type,
          required: input.required,
          unit: input.unit,
          choices: input.choices,
          wholeNumber: input.whole_number,
          minimum: input.minimum === null ? null : Number(input.minimum),
        })),
        proofType: step.proof_type,
        proofText: step.proof_text,
        proofRequirements: byPosition(rows.proofs.filter((p) => p.step_id === step.id)).map(
          (proof) => ({
            label: proof.label,
            mediaType: proof.media_type,
            minCount: proof.min_count,
            allowMultiple: proof.allow_multiple,
          }),
        ),
        confirmationText: step.confirmation_text,
        appliesWhen: step.applies_when,
      })),
    })),
  };
}
