import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { isUuid } from "@/lib/jobs/errors";
import type { StepMediaItem } from "@/lib/media/types";
import type { LiveStep } from "./sync";
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
    // Completion Work items: the job option they depend on.
    appliesWhen: "caulking_required" | "baseboard_required" | null;
    numberInStage: number;
    stepsInStage: number;
  };
  blocks: StepBlock[];
  inputs: StepInput[];
  proofs: {
    id: string;
    label: string;
    mediaType: "picture" | "video";
    minCount: number;
    allowMultiple: boolean;
  }[];
  media: StepMediaItem[];
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

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

// The saved answers on a step's current attempt.
async function loadAnswers(supabase: Supabase, attemptId: string | null) {
  if (!attemptId) {
    return { ok: true as const, checked: [], answers: {}, answeredBy: {}, notes: "", media: [] as StepMediaItem[] };
  }
  const [checks, answers, attempt, media] = await Promise.all([
    supabase.from("step_check_responses").select("*").eq("attempt_id", attemptId),
    supabase.from("step_input_responses").select("*").eq("attempt_id", attemptId),
    supabase.from("step_attempts").select("employee_notes").eq("id", attemptId).maybeSingle(),
    // Row Level Security returns nothing to unassigned employees.
    supabase
      .from("step_media")
      .select(
        "id, proof_requirement_id, media_type, status, size_bytes, declared_size_bytes, duration_seconds, original_file_name, file_last_modified, uploaded_by, authorization_expires_at, failure_reason, created_at",
      )
      .eq("attempt_id", attemptId)
      .in("status", ["pending", "uploaded", "failed"])
      .order("created_at"),
  ]);
  if (checks.error || answers.error || attempt.error || media.error) return { ok: false as const };
  const now = Date.now();
  return {
    ok: true as const,
    checked: (checks.data ?? []).filter((c) => c.checked).map((c) => c.job_block_item_id),
    answers: Object.fromEntries((answers.data ?? []).map((a) => [a.job_step_input_id, answerText(a)])) as Record<string, string>,
    answeredBy: Object.fromEntries((answers.data ?? []).map((a) => [a.job_step_input_id, a.updated_by])) as Record<string, string>,
    notes: attempt.data?.employee_notes ?? "",
    media: (media.data ?? []).map((m): StepMediaItem => {
      const abandoned = m.status === "pending" && Date.parse(m.authorization_expires_at) <= now;
      return {
        id: m.id,
        requirementId: m.proof_requirement_id,
        mediaType: m.media_type,
        status: abandoned ? "failed" : (m.status as StepMediaItem["status"]),
        sizeBytes: m.size_bytes === null ? null : Number(m.size_bytes),
        declaredSizeBytes: Number(m.declared_size_bytes),
        durationSeconds: m.duration_seconds === null ? null : Number(m.duration_seconds),
        fileName: m.original_file_name,
        lastModified: m.file_last_modified === null ? null : Number(m.file_last_modified),
        uploadedBy: m.uploaded_by,
        authorizationExpiresAt: m.authorization_expires_at,
        failureReason: abandoned ? "The upload wasn’t finished in time." : m.failure_reason,
      };
    }),
  };
}

// The latest saved state of one step: its state, edit hold, and answers.
// Open step screens call this to stay current.
export async function getStepLive(stepId: string): Promise<LiveStep | null> {
  if (!isUuid(stepId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: status, error } = await supabase
    .from("job_step_status")
    .select("*")
    .eq("job_step_id", stepId)
    .maybeSingle();
  if (error || !status) return null;
  const saved = await loadAnswers(supabase, status.attempt_id);
  if (!saved.ok) return null;
  return {
    state: status.state,
    holdHeldBy: status.hold_held_by,
    holdHeldByName: status.hold_held_by_name,
    holdExpiresAt: status.hold_expires_at,
    checked: saved.checked,
    answers: saved.answers,
    notes: saved.notes,
    media: saved.media,
  };
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

  const saved = await loadAnswers(supabase, statuses.data.attempt_id);
  if (!saved.ok) return { status: "error" };

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
        appliesWhen: step.applies_when,
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
        minCount: p.min_count,
        allowMultiple: p.allow_multiple,
      })),
      status: statuses.data,
      checked: saved.checked,
      answers: saved.answers,
      answeredBy: saved.answeredBy,
      notes: saved.notes,
      media: saved.media,
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
