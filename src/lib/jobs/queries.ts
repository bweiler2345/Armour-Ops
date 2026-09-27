import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { isUuid } from "./errors";
import { JOB_STATUS_LABELS, type JobStatus } from "./status";

// Reads jobs with the signed-in user's own session, so Row Level Security
// decides what is visible. Callers must run requireUser() or requireOwner()
// first.

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
type ProgressRow = Database["public"]["Views"]["job_progress"]["Row"];

export type JobCardData = {
  id: string;
  jobNumber: number;
  clientName: string;
  address: string;
  squareFeet: number;
  flakeColor: string;
  scheduledDate: string;
  status: JobStatus;
  statusLabel: string;
  // Job teams arrive in Phase 4; until then no one is assigned.
  teamIds: string[];
  teamNames: string[];
  currentStageName: string | null;
  currentStepTitle: string | null;
  progress: { completed: number; total: number; percent: number };
  lastActivityAt: string;
  completedAt: string | null;
};

export function toJobCard(job: JobRow, progress: ProgressRow | undefined): JobCardData {
  const total = progress?.total_units ?? 0;
  const completed = progress?.completed_units ?? 0;
  return {
    id: job.id,
    jobNumber: job.job_number,
    clientName: job.client_name,
    address: job.address,
    squareFeet: job.square_feet,
    flakeColor: job.flake_color,
    scheduledDate: job.scheduled_date,
    status: job.status,
    statusLabel: JOB_STATUS_LABELS[job.status],
    teamIds: [],
    teamNames: [],
    currentStageName: progress?.current_stage_name ?? null,
    currentStepTitle: progress?.current_step_title ?? null,
    progress: {
      completed,
      total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    lastActivityAt: job.last_activity_at,
    completedAt: job.completed_at,
  };
}

export async function listJobCards(): Promise<
  { status: "ok"; jobs: JobCardData[] } | { status: "error" }
> {
  const supabase = await createClient();
  if (!supabase) return { status: "error" };

  const [jobs, progress] = await Promise.all([
    supabase.from("jobs").select("*").order("scheduled_date"),
    supabase.from("job_progress").select("*"),
  ]);
  if (jobs.error || progress.error) return { status: "error" };

  const progressByJob = new Map((progress.data ?? []).map((p) => [p.job_id, p]));
  return {
    status: "ok",
    jobs: (jobs.data ?? []).map((job) => toJobCard(job, progressByJob.get(job.id))),
  };
}

export type JobDetail = {
  job: JobRow;
  card: JobCardData;
  stages: {
    id: string;
    name: string;
    kind: Database["public"]["Tables"]["job_stages"]["Row"]["kind"];
    ownerActionLabel: string | null;
    steps: { id: string; title: string; kind: "standard" | "completion_item"; appliesWhen: string | null }[];
  }[];
};

export async function getJobDetail(
  jobId: string,
): Promise<{ status: "ok"; detail: JobDetail } | { status: "missing" } | { status: "error" }> {
  if (!isUuid(jobId)) return { status: "missing" };
  const supabase = await createClient();
  if (!supabase) return { status: "error" };

  const [job, progress, stages, steps] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("job_progress").select("*").eq("job_id", jobId).maybeSingle(),
    supabase.from("job_stages").select("*").eq("job_id", jobId).order("position"),
    supabase.from("job_steps").select("*").eq("job_id", jobId).order("position"),
  ]);
  if (job.error || progress.error || stages.error || steps.error) return { status: "error" };
  if (!job.data) return { status: "missing" };

  return {
    status: "ok",
    detail: {
      job: job.data,
      card: toJobCard(job.data, progress.data ?? undefined),
      stages: (stages.data ?? []).map((stage) => ({
        id: stage.id,
        name: stage.name,
        kind: stage.kind,
        ownerActionLabel: stage.owner_action_label,
        steps: (steps.data ?? [])
          .filter((step) => step.job_stage_id === stage.id)
          .map((step) => ({
            id: step.id,
            title: step.title,
            kind: step.kind,
            appliesWhen: step.applies_when,
          })),
      })),
    },
  };
}

export type JobActivityEntry = {
  id: number;
  type: Database["public"]["Tables"]["job_activity"]["Row"]["activity_type"];
  actorName: string | null;
  details: Database["public"]["Tables"]["job_activity"]["Row"]["details"];
  createdAt: string;
};

// Owner pages only: owners can read every profile for names.
export async function getJobActivity(jobId: string): Promise<JobActivityEntry[] | null> {
  if (!isUuid(jobId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("job_activity")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) return null;

  const actorIds = [...new Set((data ?? []).map((a) => a.actor_id).filter((id): id is string => !!id))];
  const { data: people } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return (data ?? []).map((entry) => ({
    id: entry.id,
    type: entry.activity_type,
    actorName: entry.actor_id ? (names.get(entry.actor_id) ?? null) : null,
    details: entry.details,
    createdAt: entry.created_at,
  }));
}
