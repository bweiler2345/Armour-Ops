import { createHash } from "node:crypto";
import type { WorkflowTemplate } from "./approved-workflow";

// Generates the seed migration for one workflow template version. The output
// depends only on the template data, so running the generator twice gives
// byte-identical SQL, and a test checks the committed migration matches.
//
// The SQL is safe to run more than once: if this key and version already
// exist with the same content it does nothing, and if they exist with
// different content it stops with an error instead of guessing.

export function workflowContentHash(template: WorkflowTemplate) {
  return createHash("sha256").update(JSON.stringify(template)).digest("hex");
}

function text(value: string | null) {
  return value === null ? "null" : `'${value.replaceAll("'", "''")}'`;
}

function textArray(values: readonly string[] | null) {
  if (values === null) return "null";
  if (values.length === 0) return "'{}'::text[]";
  return `array[${values.map(text).join(", ")}]::text[]`;
}

function numberOrNull(value: number | null) {
  return value === null ? "null" : String(value);
}

export function generateWorkflowSeedSql(template: WorkflowTemplate): string {
  const hash = workflowContentHash(template);
  const out: string[] = [];
  const line = (indent: number, value: string) => out.push(`${"  ".repeat(indent)}${value}`);

  out.push(
    `-- GENERATED FILE. Do not edit by hand.`,
    `-- Source: src/lib/workflow/approved-workflow.ts (transcribed from ${template.source}).`,
    `-- Regenerate with: npm run workflow:seed`,
    `--`,
    `-- Loads "${template.name}" version ${template.version} and makes it the active`,
    `-- version. Safe to run more than once.`,
    `-- Content SHA-256: ${hash}`,
    ``,
    `do $seed$`,
    `declare`,
    `  v_existing_hash text;`,
    `  v_template uuid;`,
    `  v_stage uuid;`,
    `  v_step uuid;`,
    `  v_block uuid;`,
    `begin`,
  );

  line(1, `select content_sha256 into v_existing_hash`);
  line(1, `from public.workflow_templates`);
  line(1, `where key = ${text(template.key)} and version = ${template.version};`);
  line(0, ``);
  line(1, `if v_existing_hash = ${text(hash)} then`);
  line(2, `raise notice 'Workflow ${template.key} version ${template.version} is already loaded.';`);
  line(2, `return;`);
  line(1, `elsif v_existing_hash is not null then`);
  line(
    2,
    `raise exception 'Workflow ${template.key} version ${template.version} already exists with different content. Create a new version instead.';`,
  );
  line(1, `end if;`);
  line(0, ``);
  line(1, `insert into public.workflow_templates (key, name, version, source, content_sha256)`);
  line(
    1,
    `values (${text(template.key)}, ${text(template.name)}, ${template.version}, ${text(template.source)}, ${text(hash)})`,
  );
  line(1, `returning id into v_template;`);

  template.stages.forEach((stage, stageIndex) => {
    line(0, ``);
    line(1, `-- Stage ${stageIndex + 1}: ${stage.name}`);
    line(1, `insert into public.workflow_stage_templates`);
    line(
      2,
      `(template_id, position, key, name, kind, description, rules_heading, rules, owner_action_label, waiting_status_label, completed_status_label)`,
    );
    line(1, `values (`);
    line(2, `v_template, ${stageIndex + 1}, ${text(stage.key)}, ${text(stage.name)}, ${text(stage.kind)},`);
    line(2, `${text(stage.description)},`);
    line(2, `${text(stage.rulesHeading)},`);
    line(2, `${textArray(stage.rules)},`);
    line(
      2,
      `${text(stage.ownerAction?.label ?? null)}, ${text(stage.ownerAction?.waitingStatusLabel ?? null)}, ${text(stage.ownerAction?.completedStatusLabel ?? null)}`,
    );
    line(1, `)`);
    line(1, `returning id into v_stage;`);

    stage.steps.forEach((step, stepIndex) => {
      line(0, ``);
      line(1, `-- ${stage.name}, step ${stepIndex + 1}: ${step.title}`);
      line(1, `insert into public.workflow_step_templates`);
      line(
        2,
        `(stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)`,
      );
      line(1, `values (`);
      line(
        2,
        `v_stage, ${text(stage.kind)}, ${stepIndex + 1}, ${text(step.key)}, ${text(step.title)}, ${text(step.kind)},`,
      );
      line(2, `${text(step.note)},`);
      line(2, `${text(step.goal)},`);
      line(2, `${text(step.proofType)}, ${text(step.proofText)},`);
      line(2, `${text(step.confirmationText)},`);
      line(2, `${text(step.appliesWhen)}`);
      line(1, `)`);
      line(1, `returning id into v_step;`);

      step.blocks.forEach((block, blockIndex) => {
        const required = block.kind === "checklist";
        line(0, ``);
        line(1, `insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)`);
        line(
          1,
          `values (v_step, ${text(step.kind)}, ${blockIndex + 1}, ${text(block.heading)}, ${text(block.kind)})`,
        );
        line(1, `returning id into v_block;`);
        line(1, `insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values`);
        block.items.forEach((item, itemIndex) => {
          const end = itemIndex === block.items.length - 1 ? ";" : ",";
          line(
            2,
            `(v_block, ${text(block.kind)}, ${itemIndex + 1}, ${text(item)}, ${required})${end}`,
          );
        });
      });

      if (step.inputs.length > 0) {
        line(0, ``);
        line(
          1,
          `insert into public.workflow_step_inputs (step_id, step_kind, position, key, label, input_type, required, unit, choices, whole_number, minimum) values`,
        );
        step.inputs.forEach((input, inputIndex) => {
          const end = inputIndex === step.inputs.length - 1 ? ";" : ",";
          line(
            2,
            `(v_step, ${text(step.kind)}, ${inputIndex + 1}, ${text(input.key)}, ${text(input.label)}, ${text(input.type)}, ${input.required}, ${text(input.unit)}, ${textArray(input.choices)}, ${input.wholeNumber}, ${numberOrNull(input.minimum)})${end}`,
          );
        });
      }

      if (step.proofRequirements.length > 0) {
        line(0, ``);
        line(
          1,
          `insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values`,
        );
        step.proofRequirements.forEach((proof, proofIndex) => {
          const end = proofIndex === step.proofRequirements.length - 1 ? ";" : ",";
          line(
            2,
            `(v_step, ${text(step.proofType)}, ${proofIndex + 1}, ${text(proof.label)}, ${text(proof.mediaType)}, ${proof.minCount}, ${proof.allowMultiple})${end}`,
          );
        });
      }
    });
  });

  line(0, ``);
  line(1, `-- Validate and make this the active version.`);
  line(1, `perform public.activate_workflow_template(v_template);`);
  out.push(`end`, `$seed$;`, ``);

  return out.join("\n");
}
