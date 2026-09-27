// Job statuses in lifecycle order, with the exact labels from
// docs/PRODUCT_SPEC.md ("Job statuses"). The database enum and the allowed
// transitions below must stay in step with supabase/migrations.

export const JOB_STATUSES = [
  "scheduled",
  "available_to_claim",
  "claimed",
  "initial_prep_in_progress",
  "waiting_for_base_coat_installation",
  "base_coat_installed",
  "top_coat_prep_in_progress",
  "waiting_for_top_coat_installation",
  "top_coat_installed",
  "completion_work_in_progress",
  "complete",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  available_to_claim: "Available to Claim",
  claimed: "Claimed",
  initial_prep_in_progress: "Initial Prep in Progress",
  waiting_for_base_coat_installation: "Waiting for Base-Coat Installation",
  base_coat_installed: "Base Coat Installed",
  top_coat_prep_in_progress: "Top-Coat Prep in Progress",
  waiting_for_top_coat_installation: "Waiting for Top-Coat Installation",
  top_coat_installed: "Top Coat Installed",
  completion_work_in_progress: "Completion Work in Progress",
  complete: "Complete",
};

// Approved transitions (docs/IMPLEMENTATION_PLAN.md, "How jobs move between
// statuses"). The database enforces the same list.
export const JOB_STATUS_TRANSITIONS: readonly (readonly [JobStatus, JobStatus])[] = [
  ["scheduled", "available_to_claim"],
  ["available_to_claim", "scheduled"],
  ["available_to_claim", "claimed"],
  ["claimed", "initial_prep_in_progress"],
  ["initial_prep_in_progress", "waiting_for_base_coat_installation"],
  ["waiting_for_base_coat_installation", "base_coat_installed"],
  ["base_coat_installed", "top_coat_prep_in_progress"],
  ["top_coat_prep_in_progress", "waiting_for_top_coat_installation"],
  ["waiting_for_top_coat_installation", "top_coat_installed"],
  ["top_coat_installed", "completion_work_in_progress"],
  ["top_coat_installed", "complete"],
  ["completion_work_in_progress", "complete"],
];

export function canTransition(from: JobStatus, to: JobStatus) {
  return JOB_STATUS_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

// Jobs someone is working on: claimed through Completion Work.
export function isActiveStatus(status: JobStatus) {
  return status !== "scheduled" && status !== "available_to_claim" && status !== "complete";
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

// An owner installation milestone's state, from the job's status. Mirrors
// public.milestone_installed in the database.
export function milestoneState(
  status: JobStatus,
  stageKey: string,
): "installed" | "waiting" | "upcoming" {
  const order = JOB_STATUSES.indexOf(status);
  const at = (s: JobStatus) => JOB_STATUSES.indexOf(s);
  if (stageKey === "base_coat_installation") {
    if (order >= at("base_coat_installed")) return "installed";
    if (status === "waiting_for_base_coat_installation") return "waiting";
  }
  if (stageKey === "top_coat_installation") {
    if (order >= at("top_coat_installed")) return "installed";
    if (status === "waiting_for_top_coat_installation") return "waiting";
  }
  return "upcoming";
}
