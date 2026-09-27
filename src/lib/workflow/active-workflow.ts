import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WorkflowTemplate } from "./approved-workflow";
import { assembleWorkflow } from "./assemble";

export type ActiveWorkflow = WorkflowTemplate & {
  id: string;
  activatedAt: string | null;
  contentSha256: string;
};

export type ActiveWorkflowResult =
  | { status: "ok"; workflow: ActiveWorkflow }
  | { status: "missing" }
  | { status: "error" };

// Loads the active workflow with the signed-in user's own session, so Row
// Level Security decides what can be read. Callers must run requireUser() or
// requireOwner() first.
export async function loadActiveWorkflow(): Promise<ActiveWorkflowResult> {
  const supabase = await createClient();
  if (!supabase) return { status: "error" };

  const { data: template, error } = await supabase
    .from("workflow_templates")
    .select("*")
    .eq("status", "active")
    .maybeSingle();
  if (error) return { status: "error" };
  if (!template) return { status: "missing" };

  const [stages, steps, blocks, items, inputs, proofs] = await Promise.all([
    supabase.from("workflow_stage_templates").select("*").eq("template_id", template.id),
    supabase.from("workflow_step_templates").select("*"),
    supabase.from("workflow_step_blocks").select("*"),
    supabase.from("workflow_step_block_items").select("*"),
    supabase.from("workflow_step_inputs").select("*"),
    supabase.from("workflow_step_proof_requirements").select("*"),
  ]);
  if ([stages, steps, blocks, items, inputs, proofs].some((r) => r.error)) {
    return { status: "error" };
  }

  // Owners can read other versions too; assembleWorkflow keeps only rows
  // that belong to this template's stages.
  const workflow = assembleWorkflow({
    template,
    stages: stages.data ?? [],
    steps: steps.data ?? [],
    blocks: blocks.data ?? [],
    items: items.data ?? [],
    inputs: inputs.data ?? [],
    proofs: proofs.data ?? [],
  });

  return {
    status: "ok",
    workflow: {
      ...workflow,
      id: template.id,
      activatedAt: template.activated_at,
      contentSha256: template.content_sha256,
    },
  };
}
