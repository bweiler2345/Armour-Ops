import { isActiveStatus, type JobStatus } from "./status";

// Groups jobs into the employee Jobs screen sections from
// docs/PRODUCT_SPEC.md ("Employee Jobs screen"), in that order.

export type SectionJob = {
  id: string;
  status: JobStatus;
  scheduledDate: string;
  lastActivityAt: string;
  completedAt: string | null;
  // Employee ids on the job team. Always empty until job teams (Phase 4).
  teamIds: readonly string[];
  // Everything is done except the owner's Mark Job Complete.
  readyForOwnerCompletion?: boolean;
};

export type EmployeeSectionKey = "mine" | "other_active" | "available" | "scheduled" | "completed";

export type JobSection<T> = {
  key: EmployeeSectionKey;
  title: string;
  emptyText: string;
  jobs: T[];
};

export const EMPLOYEE_SECTIONS: readonly Omit<JobSection<never>, "jobs">[] = [
  {
    key: "mine",
    title: "My Current Jobs",
    emptyText: "You’re not on any jobs yet. Jobs you’re assigned to will show here.",
  },
  {
    key: "other_active",
    title: "Other Active Jobs",
    emptyText: "No other jobs are in progress right now.",
  },
  {
    key: "available",
    title: "Available Jobs",
    emptyText: "No jobs are available to claim right now.",
  },
  {
    key: "scheduled",
    title: "Scheduled Jobs",
    emptyText: "No upcoming jobs are scheduled yet.",
  },
  {
    key: "completed",
    title: "Completed Jobs",
    emptyText: "No completed jobs yet.",
  },
];

export function employeeSectionFor(job: SectionJob, userId: string): EmployeeSectionKey {
  if (job.status === "complete") return "completed";
  if (job.teamIds.includes(userId)) return "mine";
  if (job.status === "scheduled") return "scheduled";
  if (job.status === "available_to_claim") return "available";
  return isActiveStatus(job.status) ? "other_active" : "scheduled";
}

const byDate = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function groupJobsForEmployee<T extends SectionJob>(
  jobs: readonly T[],
  userId: string,
): JobSection<T>[] {
  return EMPLOYEE_SECTIONS.map((section) => {
    const inSection = jobs.filter((job) => employeeSectionFor(job, userId) === section.key);
    const sorted = [...inSection].sort((a, b) => {
      if (section.key === "completed") {
        return byDate(b.completedAt ?? b.lastActivityAt, a.completedAt ?? a.lastActivityAt);
      }
      if (section.key === "available" || section.key === "scheduled") {
        return byDate(a.scheduledDate, b.scheduledDate);
      }
      return byDate(b.lastActivityAt, a.lastActivityAt);
    });
    return { ...section, jobs: sorted };
  });
}

// What needs the owner right now, for the Owner Dashboard: jobs waiting for
// each installation, and jobs ready for Mark Job Complete. Oldest first.
export function ownerAttention<T extends SectionJob>(jobs: readonly T[]) {
  const oldest = (list: T[]) => [...list].sort((a, b) => byDate(a.lastActivityAt, b.lastActivityAt));
  const waitingBase = oldest(jobs.filter((j) => j.status === "waiting_for_base_coat_installation"));
  const waitingTop = oldest(jobs.filter((j) => j.status === "waiting_for_top_coat_installation"));
  const readyToComplete = oldest(jobs.filter((j) => j.status !== "complete" && j.readyForOwnerCompletion === true));
  return {
    waitingBase,
    waitingTop,
    readyToComplete,
    total: waitingBase.length + waitingTop.length + readyToComplete.length,
  };
}

export type OwnerGroupKey =
  | "needs_owner"
  | "scheduled"
  | "available"
  | "in_progress"
  | "complete";

// The owner's Jobs screen groups. Jobs waiting for an installation or ready
// for Mark Job Complete come first, apart from the rest of the work in
// progress.
export function ownerGroupFor(job: SectionJob): OwnerGroupKey {
  if (job.status === "complete") return "complete";
  if (job.status === "scheduled") return "scheduled";
  if (job.status === "available_to_claim") return "available";
  if (
    job.status === "waiting_for_base_coat_installation" ||
    job.status === "waiting_for_top_coat_installation" ||
    job.readyForOwnerCompletion === true
  ) {
    return "needs_owner";
  }
  return "in_progress";
}
