import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { isUuid } from "@/lib/jobs/errors";
import type { StepInput } from "./validation";

// Reads a job's step work with the signed-in user's own session, so Row
// Level Security decides what is visible. Everything comes from the job's
// own workflow snapshot, never the current template. Callers must run
// requireUser() first.

type StatusRow = Database["public"]["Views"]["job_step_status"]["Row"];
export type StepState = StatusRow["state"];

export type StepBlock = {
  id: string;
  heading: string;
  kind: "ordered_list" | "reference_list" | "checklist";
  items: { id: string; text: string; required: boolean }[];
};

export type StepDetail = {
  job: { id: string; jobNumber: number; clientName: string; status: Database["public"]["Tables"]["jobs"]["Row"]["status"] };
  stage: { name: string; kind: string; position: number };
  step: {
    id: string;
    title: string;
    kind: "standard" | "completion_item";
    note: string | null;
    goal: string | null;
    proofType: "none" | "picture" | "video";
    proofText: string | null;
    confirmationText: string | null;
    numberInStage: number;
    stepsInStage: number;
  };
  blocks: StepBlock[];
  inputs: StepInput[];
  proofs: { id: string; label: string; mediaType: "picture" | "video"; allowMultiple: boolean }[];
  status: StatusRow;
  checked: string[];
  answers: Record<string, string>;
  answeredBy: Record<string, string>;
  notes: string;
  teamIds: string[];
  nextStepId: string | null;
  previousStepId: string | null;
};

function answerText(row: Database["public"]["Tables"]["step_input_responses"]["Row"]) {
  if (row.value_choice !== null) return row.value_choice;
  if (row.value_number !== null) return String(row.value_number);
  return row.value_text ?? "";
}

export async function getStepDetail(
  jobId: string,
  stepId: string,
): Promise<{ status: "ok"; detail: StepDetail } | { status: "missing" } | { status: "error" }> {
  if (!isUuid(jobId) || !isUuid(stepId)) return { status: "missing" };
  const supabase = await createClient();
  if (!supabase) return { status: "error" };

  const [job, stages, steps, blocks, items, inputs, proofs, statuses, team] = await Promise.all([
    supabase.from("jobs").select("id, job_number, client_name, status").eq("id", jobId).maybeSingle(),
    supabase.from("job_stages").select("*").eq("job_id", jobId),
    supabase.from("job_steps").select("*").eq("job_id", jobId),
    supabase.from("job_step_blocks").select("*").eq("job_step_id", stepId).order("position"),
    supabase.from("job_step_block_items").select("*").eq("job_id", jobId).order("position"),
    supabase.from("job_step_inputs").select("*").eq("job_step_id", stepId).order("position"),
    supabase.from("job_step_proof_requirements").select("*").eq("job_step_id", stepId).order("position"),
    supabase.from("job_step_status").select("*").eq("job_step_id", stepId).maybeSingle(),
    supabase.from("job_team").select("employee_id").eq("job_id", jobId),
  ]);
  const results = [job, stages, steps, blocks, items, inputs, proofs, statuses, team];
  if (results.some((r) => r.error)) return { status: "error" };
  if (!job.data || !statuses.data) return { status: "missing" };

  const step = (steps.data ?? []).find((s) => s.id === stepId);
  if (!step) return { status: "missing" };
  const stage = (stages.data ?? []).find((s) => s.id === step.job_stage_id);
  if (!stage) return { status: "missing" };

  // Standard steps in workflow order, for previous/next links.
  const stagePosition = new Map((stages.data ?? []).map((s) => [s.id, s.position]));
  const ordered = (steps.data ?? [])
    .filter((s) => s.kind === "standard")
    .sort(
      (a, b) =>
        (stagePosition.get(a.job_stage_id) ?? 0) - (stagePosition.get(b.job_stage_id) ?? 0) ||
        a.position - b.position,
    );
  const index = ordered.findIndex((s) => s.id === stepId);
  const inStage = ordered.filter((s) => s.job_stage_id === step.job_stage_id);

  const attemptId = statuses.data.attempt_id;
  const [checks, answers, attempt] = attemptId
    ? await Promise.all([
        supabase.from("step_check_responses").select("*").eq("attempt_id", attemptId),
        supabase.from("step_input_responses").select("*").eq("attempt_id", attemptId),
        supabase.from("step_attempts").select("employee_notes").eq("id", attemptId).maybeSingle(),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: null, error: null }];
  if (checks.error || answers.error || attempt.error) return { status: "error" };

  const blockIds = new Set((blocks.data ?? []).map((b) => b.id));
  return {
    status: "ok",
    detail: {
      job: {
        id: job.data.id,
        jobNumber: job.data.job_number,
        clientName: job.data.client_name,
        status: job.data.status,
      },
      stage: { name: stage.name, kind: stage.kind, position: stage.position },
      step: {
        id: step.id,
        title: step.title,
        kind: step.kind,
        note: step.note,
        goal: step.goal,
        proofType: step.proof_type,
        proofText: step.proof_text,
        confirmationText: step.confirmation_text,
        numberInStage: inStage.findIndex((s) => s.id === stepId) + 1,
        stepsInStage: inStage.length,
      },
      blocks: (blocks.data ?? []).map((block) => ({
        id: block.id,
        heading: block.heading,
        kind: block.kind,
        items: (items.data ?? [])
          .filter((i) => i.job_block_id === block.id && blockIds.has(i.job_block_id))
          .map((i) => ({ id: i.id, text: i.text, required: i.required })),
      })),
      inputs: (inputs.data ?? []).map((i) => ({
        id: i.id,
        label: i.label,
        type: i.input_type,
        required: i.required,
        choices: i.choices,
        wholeNumber: i.whole_number,
        minimum: i.minimum === null ? null : Number(i.minimum),
      })),
      proofs: (proofs.data ?? []).map((p) => ({
        id: p.id,
        label: p.label,
        mediaType: p.media_type,
        allowMultiple: p.allow_multiple,
      })),
      status: statuses.data,
      checked: (checks.data ?? []).filter((c) => c.checked).map((c) => c.job_block_item_id),
      answers: Object.fromEntries((answers.data ?? []).map((a) => [a.job_step_input_id, answerText(a)])),
      answeredBy: Object.fromEntries((answers.data ?? []).map((a) => [a.job_step_input_id, a.updated_by])),
      notes: attempt.data?.employee_notes ?? "",
      teamIds: (team.data ?? []).map((t) => t.employee_id),
      nextStepId: index >= 0 ? (ordered[index + 1]?.id ?? null) : null,
      previousStepId: index > 0 ? ordered[index - 1].id : null,
    },
  };
}

export type WorkflowStepStatus = {
  state: StepState;
  completedByName: string | null;
  completedAt: string | null;
  holdByName: string | null;
  holdExpiresAt: string | null;
};

export async function getJobStepStatuses(jobId: string): Promise<Map<string, WorkflowStepStatus> | null> {
  if (!isUuid(jobId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("job_step_status").select("*").eq("job_id", jobId);
  if (error) return null;
  return new Map(
    (data ?? []).map((row) => [
      row.job_step_id,
      {
        state: row.state,
        completedByName: row.completed_by_name,
        completedAt: row.completed_at,
        holdByName: row.hold_held_by_name,
        holdExpiresAt: row.hold_expires_at,
      },
    ]),
  );
}
