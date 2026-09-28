import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { isUuid } from "./errors";
import { JOB_STATUS_LABELS, type JobStatus } from "./status";
import { sortTeam, teamNamesWithOwners, type TeamMember, type WorkingOwner } from "./team";

// Reads jobs with the signed-in user's own session, so Row Level Security
// decides what is visible. Callers must run requireUser() or requireOwner()
// first.

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
type ProgressRow = Database["public"]["Views"]["job_progress"]["Row"];
type TeamRow = Database["public"]["Views"]["job_team"]["Row"];
type WorkingOwnerRow = Database["public"]["Views"]["job_working_owner_status"]["Row"];

function toWorkingOwners(rows: readonly WorkingOwnerRow[]): WorkingOwner[] {
  return rows.map((row) => ({ ownerId: row.owner_id, name: row.full_name.trim() || "Owner", active: row.owner_active }));
}

function toTeam(rows: readonly TeamRow[]): TeamMember[] {
  return sortTeam(
    rows.map((row) => ({
      employeeId: row.employee_id,
      name: row.full_name,
      role: row.role,
      active: row.employee_active,
    })),
  );
}

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
  team: TeamMember[];
  teamIds: string[];
  // Owners on the working team (never the lead or members).
  workingOwners: WorkingOwner[];
  // Lead first, marked "(Lead)", then members, then working owners marked
  // "(Owner · Working Member)".
  teamNames: string[];
  currentStageName: string | null;
  currentStepTitle: string | null;
  progress: { completed: number; total: number; percent: number };
  lastActivityAt: string;
  completedAt: string | null;
  // Both milestones and all applicable Completion Work are done; waiting for
  // the owner's Mark Job Complete.
  readyForOwnerCompletion: boolean;
  // A step the owner reopened that the team hasn't redone yet.
  reopenedStepTitle: string | null;
};

export function toJobCard(
  job: JobRow,
  progress: ProgressRow | undefined,
  teamRows: readonly TeamRow[] = [],
  ownerRows: readonly WorkingOwnerRow[] = [],
): JobCardData {
  const team = toTeam(teamRows);
  const workingOwners = toWorkingOwners(ownerRows);
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
    team,
    teamIds: team.map((m) => m.employeeId),
    workingOwners,
    teamNames: teamNamesWithOwners(team, workingOwners),
    currentStageName: progress?.current_stage_name ?? null,
    currentStepTitle: progress?.current_step_title ?? null,
    progress: {
      completed,
      total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    lastActivityAt: job.last_activity_at,
    completedAt: job.completed_at,
    readyForOwnerCompletion: progress?.ready_for_owner_completion ?? false,
    reopenedStepTitle: progress?.reopened_step_title ?? null,
  };
}

export async function listJobCards(): Promise<
  { status: "ok"; jobs: JobCardData[] } | { status: "error" }
> {
  const supabase = await createClient();
  if (!supabase) return { status: "error" };

  const [jobs, progress, teams, owners] = await Promise.all([
    supabase.from("jobs").select("*").order("scheduled_date"),
    supabase.from("job_progress").select("*"),
    supabase.from("job_team").select("*"),
    supabase.from("job_working_owner_status").select("*"),
  ]);
  if (jobs.error || progress.error || teams.error || owners.error) return { status: "error" };

  const progressByJob = new Map((progress.data ?? []).map((p) => [p.job_id, p]));
  const teamsByJob = new Map<string, TeamRow[]>();
  for (const row of teams.data ?? []) {
    teamsByJob.set(row.job_id, [...(teamsByJob.get(row.job_id) ?? []), row]);
  }
  return {
    status: "ok",
    jobs: (jobs.data ?? []).map((job) =>
      toJobCard(
        job,
        progressByJob.get(job.id),
        teamsByJob.get(job.id),
        (owners.data ?? []).filter((o) => o.job_id === job.id),
      ),
    ),
  };
}

export type JobDetail = {
  job: JobRow;
  card: JobCardData;
  stages: {
    id: string;
    key: string;
    name: string;
    kind: Database["public"]["Tables"]["job_stages"]["Row"]["kind"];
    ownerActionLabel: string | null;
    steps: {
      id: string;
      title: string;
      kind: "standard" | "completion_item";
      appliesWhen: string | null;
      origin: "standard" | "library" | "one_time";
    }[];
  }[];
  // Installed milestones by stage key, with who marked them and when.
  milestones: Record<string, { installedByName: string | null; installedAt: string }>;
  // Owners on the working team (not the employee lead or members).
  workingOwners: WorkingOwner[];
};

export async function getJobDetail(
  jobId: string,
): Promise<{ status: "ok"; detail: JobDetail } | { status: "missing" } | { status: "error" }> {
  if (!isUuid(jobId)) return { status: "missing" };
  const supabase = await createClient();
  if (!supabase) return { status: "error" };

  const [job, progress, stages, steps, team, milestones, working] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("job_progress").select("*").eq("job_id", jobId).maybeSingle(),
    supabase.from("job_stages").select("*").eq("job_id", jobId).order("position"),
    supabase.from("job_steps").select("*").eq("job_id", jobId).order("position"),
    supabase.from("job_team").select("*").eq("job_id", jobId),
    supabase.from("job_milestone_status").select("*").eq("job_id", jobId),
    supabase.from("job_working_owner_status").select("*").eq("job_id", jobId),
  ]);
  if (job.error || progress.error || stages.error || steps.error || team.error || milestones.error || working.error) {
    return { status: "error" };
  }
  if (!job.data) return { status: "missing" };

  return {
    status: "ok",
    detail: {
      job: job.data,
      card: toJobCard(job.data, progress.data ?? undefined, team.data ?? [], working.data ?? []),
      stages: (stages.data ?? []).map((stage) => ({
        id: stage.id,
        key: stage.key,
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
            origin: !step.is_custom
              ? ("standard" as const)
              : step.custom_origin === "library_import"
                ? ("library" as const)
                : ("one_time" as const),
          })),
      })),
      workingOwners: toWorkingOwners(working.data ?? []),
      milestones: Object.fromEntries(
        (milestones.data ?? []).map((m) => [
          m.milestone_key,
          { installedByName: m.installed_by_name, installedAt: m.installed_at },
        ]),
      ),
    },
  };
}

export type JobActivityEntry = {
  id: number;
  type: Database["public"]["Tables"]["job_activity"]["Row"]["activity_type"];
  actorName: string | null;
  // Names of employees mentioned in the details (employee_id, from/to lead).
  names: Record<string, string>;
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

  const mentioned = (data ?? []).flatMap((entry) => {
    const details = (entry.details ?? {}) as Record<string, unknown>;
    return [entry.actor_id, details.employee_id, details.from_employee_id, details.to_employee_id];
  });
  const personIds = [...new Set(mentioned.filter((id): id is string => isUuid(id)))];
  const { data: people } = personIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", personIds)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return (data ?? []).map((entry) => ({
    id: entry.id,
    type: entry.activity_type,
    actorName: entry.actor_id ? (names.get(entry.actor_id) ?? null) : null,
    names: Object.fromEntries(names),
    details: entry.details,
    createdAt: entry.created_at,
  }));
}

export type EmployeeOption = { id: string; name: string };

// Owner pages only: active employees who can be added to a team.
export async function listActiveEmployees(): Promise<EmployeeOption[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, active")
    .eq("role", "employee")
    .eq("active", true)
    .order("full_name");
  if (error) return null;
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name.trim() || "Unnamed employee" }));
}
