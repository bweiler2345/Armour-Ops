import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/jobs/status";

// The Owner Dashboard's view of every job (from public.owner_dashboard()),
// and the pure rules for grouping, ordering, and filtering it. The database
// does the counting and joining; this decides what the owner sees first.

export type DashboardPerson = { id: string; name: string; active: boolean };

export type DashboardJob = {
  id: string;
  jobNumber: number;
  clientName: string;
  address: string;
  squareFeet: number;
  flakeColor: string;
  scheduledDate: string;
  status: JobStatus;
  lastActivityAt: string;
  completedAt: string | null;
  progress: { completed: number; total: number; percent: number };
  currentStageName: string | null;
  currentStepTitle: string | null;
  currentStepId: string | null;
  readyForOwnerCompletion: boolean;
  reopenedStepTitle: string | null;
  lead: DashboardPerson | null;
  members: DashboardPerson[];
  workingOwners: DashboardPerson[];
  lastActivity: { type: string; actorName: string | null; title: string | null; at: string } | null;
  editor: { name: string; stepTitle: string; expiresAt: string } | null;
  unfinishedUploads: number;
  failedUploads: number;
};

export type Category = "needs_owner" | "active" | "scheduled" | "available" | "complete";

export const CATEGORIES: readonly { key: Category; title: string; empty: string }[] = [
  { key: "needs_owner", title: "Needs you", empty: "Nothing is waiting for you right now." },
  { key: "active", title: "In progress", empty: "No jobs are being worked right now." },
  { key: "scheduled", title: "Scheduled", empty: "No Scheduled jobs." },
  { key: "available", title: "Available to claim", empty: "No jobs are available to claim." },
  { key: "complete", title: "Recently completed", empty: "No completed jobs yet." },
];

// Completed jobs shown on the dashboard; the Jobs screen lists all of them.
export const RECENT_COMPLETE_LIMIT = 10;

export function categoryOf(job: Pick<DashboardJob, "status" | "readyForOwnerCompletion">): Category {
  if (job.status === "complete") return "complete";
  if (job.status === "scheduled") return "scheduled";
  if (job.status === "available_to_claim") return "available";
  if (
    job.status === "waiting_for_base_coat_installation" ||
    job.status === "waiting_for_top_coat_installation" ||
    job.readyForOwnerCompletion
  ) {
    return "needs_owner";
  }
  return "active";
}

// The status as the owner reads it, including Ready to Mark Complete.
export function statusLabel(job: Pick<DashboardJob, "status" | "readyForOwnerCompletion">) {
  return job.readyForOwnerCompletion && job.status !== "complete" ? "Ready to Mark Complete" : JOB_STATUS_LABELS[job.status];
}

// What the owner needs to do, for jobs in "Needs you".
export function ownerAction(job: DashboardJob): string | null {
  if (job.reopenedStepTitle) return null;
  if (job.status === "waiting_for_base_coat_installation") return "Mark Base Coat Installed";
  if (job.status === "waiting_for_top_coat_installation") return "Mark Top Coat Installed";
  if (job.readyForOwnerCompletion && job.status !== "complete") return "Review and Mark Job Complete";
  return null;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Owner action first (longest waiting first), then work in progress
// (reopened work first, then most recent activity), upcoming Scheduled and
// Available jobs by date, and completed jobs newest first.
export function sortInCategory(category: Category, jobs: readonly DashboardJob[]): DashboardJob[] {
  return [...jobs].sort((a, b) => {
    switch (category) {
      case "needs_owner":
        return cmp(a.lastActivityAt, b.lastActivityAt);
      case "active":
        return Number(Boolean(b.reopenedStepTitle)) - Number(Boolean(a.reopenedStepTitle)) || cmp(b.lastActivityAt, a.lastActivityAt);
      case "scheduled":
      case "available":
        return cmp(a.scheduledDate, b.scheduledDate) || a.jobNumber - b.jobNumber;
      case "complete":
        return cmp(b.completedAt ?? b.lastActivityAt, a.completedAt ?? a.lastActivityAt);
    }
  });
}

export type Filters = {
  search: string;
  category: Category | "all";
  employeeId: string;
  from: string;
  to: string;
};

export const NO_FILTERS: Filters = { search: "", category: "all", employeeId: "", from: "", to: "" };

export function matches(job: DashboardJob, filters: Filters): boolean {
  const search = filters.search.trim().toLowerCase();
  if (search && !`${job.clientName} ${job.address} #${job.jobNumber}`.toLowerCase().includes(search)) return false;
  if (filters.category !== "all" && categoryOf(job) !== filters.category) return false;
  if (filters.employeeId) {
    const people = [job.lead, ...job.members, ...job.workingOwners].filter(Boolean) as DashboardPerson[];
    if (!people.some((p) => p.id === filters.employeeId)) return false;
  }
  if (filters.from && job.scheduledDate < filters.from) return false;
  if (filters.to && job.scheduledDate > filters.to) return false;
  return true;
}

export function groupDashboard(jobs: readonly DashboardJob[], filters: Filters = NO_FILTERS) {
  const visible = jobs.filter((j) => matches(j, filters));
  return CATEGORIES.map((c) => {
    const inCategory = sortInCategory(c.key, visible.filter((j) => categoryOf(j) === c.key));
    return {
      ...c,
      count: inCategory.length,
      jobs: c.key === "complete" ? inCategory.slice(0, RECENT_COMPLETE_LIMIT) : inCategory,
    };
  });
}

// Everyone who appears on a job, for the "assigned to" filter.
export function peopleOn(jobs: readonly DashboardJob[]): DashboardPerson[] {
  const byId = new Map<string, DashboardPerson>();
  for (const job of jobs) {
    for (const p of [job.lead, ...job.members, ...job.workingOwners]) if (p) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function jobLinks(job: Pick<DashboardJob, "id" | "currentStepId">) {
  return {
    job: `/owner/jobs/${job.id}`,
    step: job.currentStepId ? `/jobs/${job.id}/steps/${job.currentStepId}` : null,
  };
}

// Filters kept in the address so a reload (or the automatic refresh) keeps
// what the owner chose.
export function filtersFromParams(params: Record<string, string | string[] | undefined>): Filters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const category = one("category");
  const date = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");
  return {
    search: one("q").slice(0, 100),
    category: CATEGORIES.some((c) => c.key === category) ? (category as Category) : "all",
    employeeId: /^[0-9a-f-]{36}$/i.test(one("person")) ? one("person") : "",
    from: date(one("from")),
    to: date(one("to")),
  };
}

export function filtersToQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.employeeId) params.set("person", filters.employeeId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

type Row = {
  job_id: string;
  job_number: number;
  client_name: string;
  address: string;
  square_feet: number;
  flake_color: string;
  scheduled_date: string;
  status: JobStatus;
  last_activity_at: string;
  completed_at: string | null;
  total_units: number;
  completed_units: number;
  current_stage_name: string | null;
  current_step_title: string | null;
  ready_for_owner_completion: boolean;
  reopened_step_title: string | null;
  current_step_id: string | null;
  team: unknown;
  working_owners: unknown;
  last_activity_type: string | null;
  last_activity_actor: string | null;
  last_activity_title: string | null;
  last_activity_time: string | null;
  editor_name: string | null;
  editor_step_title: string | null;
  editor_expires_at: string | null;
  unfinished_uploads: number;
  failed_uploads: number;
};

type TeamEntry = { id: string; name: string; role?: string; active: boolean };

export function toDashboardJob(row: Row): DashboardJob {
  const team = (Array.isArray(row.team) ? row.team : []) as TeamEntry[];
  const person = (p: TeamEntry): DashboardPerson => ({ id: p.id, name: p.name?.trim() || "Unnamed", active: p.active });
  const lead = team.find((p) => p.role === "lead");
  const total = row.total_units ?? 0;
  const completed = row.completed_units ?? 0;
  return {
    id: row.job_id,
    jobNumber: row.job_number,
    clientName: row.client_name,
    address: row.address,
    squareFeet: row.square_feet,
    flakeColor: row.flake_color,
    scheduledDate: row.scheduled_date,
    status: row.status,
    lastActivityAt: row.last_activity_at,
    completedAt: row.completed_at,
    progress: { completed, total, percent: total > 0 ? Math.round((completed / total) * 100) : 0 },
    currentStageName: row.current_stage_name,
    currentStepTitle: row.current_step_title,
    currentStepId: row.current_step_id,
    readyForOwnerCompletion: row.ready_for_owner_completion,
    reopenedStepTitle: row.reopened_step_title,
    lead: lead ? person(lead) : null,
    members: team.filter((p) => p.role === "member").map(person),
    workingOwners: ((Array.isArray(row.working_owners) ? row.working_owners : []) as TeamEntry[]).map(person),
    lastActivity: row.last_activity_time
      ? { type: row.last_activity_type ?? "", actorName: row.last_activity_actor, title: row.last_activity_title, at: row.last_activity_time }
      : null,
    editor:
      row.editor_name && row.editor_expires_at
        ? { name: row.editor_name, stepTitle: row.editor_step_title ?? "a step", expiresAt: row.editor_expires_at }
        : null,
    unfinishedUploads: row.unfinished_uploads ?? 0,
    failedUploads: row.failed_uploads ?? 0,
  };
}
