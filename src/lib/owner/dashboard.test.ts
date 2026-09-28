import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { JobStatus } from "@/lib/jobs/status";
import {
  categoryOf,
  filtersFromParams,
  filtersToQuery,
  groupDashboard,
  jobLinks,
  NO_FILTERS,
  ownerAction,
  peopleOn,
  RECENT_COMPLETE_LIMIT,
  statusLabel,
  toDashboardJob,
  type DashboardJob,
} from "./dashboard";

const LEAD = { id: "11111111-1111-4111-8111-111111111111", name: "Sample Lead", active: true };
const MEMBER = { id: "22222222-2222-4222-8222-222222222222", name: "Sample Member", active: true };
const OWNER = { id: "33333333-3333-4333-8333-333333333333", name: "Sample Owner", active: true };

let n = 0;
function job(status: JobStatus, overrides: Partial<DashboardJob> = {}): DashboardJob {
  n += 1;
  return {
    id: `job-${n}`,
    jobNumber: 1000 + n,
    clientName: `Client ${n}`,
    address: `${n} Sample Road`,
    squareFeet: 500,
    flakeColor: "Sample",
    scheduledDate: "2026-10-20",
    status,
    lastActivityAt: "2026-10-20T12:00:00Z",
    completedAt: status === "complete" ? "2026-10-25T12:00:00Z" : null,
    progress: { completed: 0, total: 10, percent: 0 },
    currentStageName: null,
    currentStepTitle: null,
    currentStepId: null,
    readyForOwnerCompletion: false,
    reopenedStepTitle: null,
    lead: null,
    members: [],
    workingOwners: [],
    lastActivity: null,
    editor: null,
    unfinishedUploads: 0,
    failedUploads: 0,
    ...overrides,
  };
}

describe("dashboard categories and labels", () => {
  it("puts every status in the right category with the right label", () => {
    const cases: [JobStatus, boolean, string, string][] = [
      ["scheduled", false, "scheduled", "Scheduled"],
      ["available_to_claim", false, "available", "Available to Claim"],
      ["claimed", false, "active", "Claimed"],
      ["initial_prep_in_progress", false, "active", "Initial Prep in Progress"],
      ["waiting_for_base_coat_installation", false, "needs_owner", "Waiting for Base-Coat Installation"],
      ["base_coat_installed", false, "active", "Base Coat Installed"],
      ["top_coat_prep_in_progress", false, "active", "Top-Coat Prep in Progress"],
      ["waiting_for_top_coat_installation", false, "needs_owner", "Waiting for Top-Coat Installation"],
      ["top_coat_installed", false, "active", "Top Coat Installed"],
      ["completion_work_in_progress", false, "active", "Completion Work in Progress"],
      ["completion_work_in_progress", true, "needs_owner", "Ready to Mark Complete"],
      ["top_coat_installed", true, "needs_owner", "Ready to Mark Complete"],
      ["complete", false, "complete", "Complete"],
    ];
    for (const [status, ready, category, label] of cases) {
      const j = job(status, { readyForOwnerCompletion: ready });
      expect(categoryOf(j), status).toBe(category);
      expect(statusLabel(j), status).toBe(label);
    }
  });

  it("names the owner action, and none while a reopened step waits", () => {
    expect(ownerAction(job("waiting_for_base_coat_installation"))).toBe("Mark Base Coat Installed");
    expect(ownerAction(job("waiting_for_top_coat_installation"))).toBe("Mark Top Coat Installed");
    expect(ownerAction(job("completion_work_in_progress", { readyForOwnerCompletion: true }))).toBe("Review and Mark Job Complete");
    expect(ownerAction(job("waiting_for_base_coat_installation", { reopenedStepTitle: "Grind Floor" }))).toBeNull();
    expect(ownerAction(job("initial_prep_in_progress"))).toBeNull();
  });
});

describe("dashboard grouping and ordering", () => {
  it("counts each category and orders owner action, active work, upcoming, available, and recent completions", () => {
    const jobs = [
      job("complete", { id: "c-old", completedAt: "2026-10-01T00:00:00Z" }),
      job("complete", { id: "c-new", completedAt: "2026-10-09T00:00:00Z" }),
      job("scheduled", { id: "s-late", scheduledDate: "2026-11-05" }),
      job("scheduled", { id: "s-soon", scheduledDate: "2026-10-22" }),
      job("available_to_claim", { id: "a1" }),
      job("initial_prep_in_progress", { id: "w-old-activity", lastActivityAt: "2026-10-20T08:00:00Z" }),
      job("top_coat_prep_in_progress", { id: "w-new-activity", lastActivityAt: "2026-10-20T15:00:00Z" }),
      job("base_coat_installed", { id: "w-reopened", reopenedStepTitle: "Grind Floor", lastActivityAt: "2026-10-19T00:00:00Z" }),
      job("waiting_for_top_coat_installation", { id: "o-new", lastActivityAt: "2026-10-20T10:00:00Z" }),
      job("waiting_for_base_coat_installation", { id: "o-old", lastActivityAt: "2026-10-18T10:00:00Z" }),
      job("completion_work_in_progress", { id: "o-ready", readyForOwnerCompletion: true, lastActivityAt: "2026-10-19T10:00:00Z" }),
    ];
    const groups = groupDashboard(jobs);
    expect(groups.map((g) => [g.key, g.count])).toEqual([
      ["needs_owner", 3],
      ["active", 3],
      ["scheduled", 2],
      ["available", 1],
      ["complete", 2],
    ]);
    expect(groups.map((g) => g.jobs.map((j) => j.id))).toEqual([
      ["o-old", "o-ready", "o-new"],
      ["w-reopened", "w-new-activity", "w-old-activity"],
      ["s-soon", "s-late"],
      ["a1"],
      ["c-new", "c-old"],
    ]);
  });

  it("shows only the most recent completed jobs but counts them all", () => {
    const jobs = Array.from({ length: RECENT_COMPLETE_LIMIT + 5 }, (_, i) =>
      job("complete", { completedAt: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z` }),
    );
    const complete = groupDashboard(jobs).find((g) => g.key === "complete")!;
    expect(complete.count).toBe(RECENT_COMPLETE_LIMIT + 5);
    expect(complete.jobs).toHaveLength(RECENT_COMPLETE_LIMIT);
    expect(complete.jobs[0].completedAt).toBe("2026-10-15T00:00:00Z");
  });

  it("gives empty categories no jobs (the screen shows an empty message)", () => {
    expect(groupDashboard([]).every((g) => g.count === 0 && g.jobs.length === 0)).toBe(true);
  });
});

describe("dashboard search and filters", () => {
  const jobs = [
    job("initial_prep_in_progress", { id: "f1", clientName: "Lakeside Garage", address: "10 Elm Street", lead: LEAD, members: [MEMBER], scheduledDate: "2026-10-10" }),
    job("scheduled", { id: "f2", clientName: "Hilltop Shop", address: "22 Oak Avenue", scheduledDate: "2026-11-20" }),
    job("waiting_for_top_coat_installation", { id: "f3", clientName: "Riverside", address: "3 Pine Road", lead: MEMBER, workingOwners: [OWNER], scheduledDate: "2026-10-15" }),
  ];
  const ids = (filters: Partial<typeof NO_FILTERS>) =>
    groupDashboard(jobs, { ...NO_FILTERS, ...filters }).flatMap((g) => g.jobs.map((j) => j.id));

  it("searches client, address, and job number", () => {
    expect(ids({ search: "lakeside" })).toEqual(["f1"]);
    expect(ids({ search: "OAK" })).toEqual(["f2"]);
    expect(ids({ search: `#${jobs[2].jobNumber}` })).toEqual(["f3"]);
    expect(ids({ search: "nothing like this" })).toEqual([]);
  });

  it("filters by category, assigned person (including a Working Owner), and scheduled dates", () => {
    expect(ids({ category: "scheduled" })).toEqual(["f2"]);
    expect(ids({ employeeId: MEMBER.id }).sort()).toEqual(["f1", "f3"]);
    expect(ids({ employeeId: OWNER.id })).toEqual(["f3"]);
    expect(ids({ from: "2026-10-12", to: "2026-10-31" })).toEqual(["f3"]);
    expect(peopleOn(jobs).map((p) => p.name)).toEqual(["Sample Lead", "Sample Member", "Sample Owner"]);
  });

  it("keeps filters in the address so a refresh or reload keeps them", () => {
    const filters = { search: "oak", category: "active" as const, employeeId: LEAD.id, from: "2026-10-01", to: "2026-10-31" };
    const query = filtersToQuery(filters);
    expect(filtersFromParams(Object.fromEntries(new URLSearchParams(query.slice(1))))).toEqual(filters);
    expect(filtersToQuery(NO_FILTERS)).toBe("");
    // Anything unexpected is ignored.
    expect(filtersFromParams({ category: "everything", person: "x", from: "soon", q: "a".repeat(500) })).toEqual({
      ...NO_FILTERS,
      search: "a".repeat(100),
    });
  });

  it("keeps filters in client state, so the automatic refresh never resets them", () => {
    const board = readFileSync("src/app/(app)/owner/OwnerDashboard.tsx", "utf8");
    expect(board).toContain("useState<Filters>(initialFilters)");
    expect(board).toContain("window.history.replaceState");
    expect(board).not.toMatch(/router\.(push|replace)\(/);
  });
});

describe("dashboard rows", () => {
  it("maps the database row: progress, team roles, editor, uploads, and links", () => {
    const mapped = toDashboardJob({
      job_id: "j1",
      job_number: 1001,
      client_name: "Sample",
      address: "1 Sample Road",
      square_feet: 500,
      flake_color: "Sample",
      scheduled_date: "2026-10-20",
      status: "initial_prep_in_progress",
      last_activity_at: "2026-10-20T12:00:00Z",
      completed_at: null,
      total_units: 16,
      completed_units: 4,
      current_stage_name: "Initial Prep",
      current_step_title: "Patchwork",
      ready_for_owner_completion: false,
      reopened_step_title: null,
      current_step_id: "s3",
      team: [
        { id: MEMBER.id, name: "Sample Member", role: "member", active: true },
        { id: LEAD.id, name: "Sample Lead", role: "lead", active: true },
      ],
      working_owners: [{ id: OWNER.id, name: "Sample Owner", active: true }],
      last_activity_type: "step_completed",
      last_activity_actor: "Sample Lead",
      last_activity_title: "Vacuum Floor",
      last_activity_time: "2026-10-20T12:00:00Z",
      editor_name: "Sample Member",
      editor_step_title: "Patchwork",
      editor_expires_at: "2026-10-20T12:02:00Z",
      unfinished_uploads: 1,
      failed_uploads: 2,
    });
    expect(mapped).toMatchObject({
      progress: { completed: 4, total: 16, percent: 25 },
      lead: LEAD,
      members: [MEMBER],
      workingOwners: [OWNER],
      editor: { name: "Sample Member", stepTitle: "Patchwork", expiresAt: "2026-10-20T12:02:00Z" },
      lastActivity: { type: "step_completed", actorName: "Sample Lead", title: "Vacuum Floor", at: "2026-10-20T12:00:00Z" },
      unfinishedUploads: 1,
      failedUploads: 2,
    });
    expect(jobLinks(mapped)).toEqual({ job: "/owner/jobs/j1", step: "/jobs/j1/steps/s3" });
    expect(jobLinks({ id: "j2", currentStepId: null })).toEqual({ job: "/owner/jobs/j2", step: null });
  });

  it("is owner only on the server, and the page never builds file links or shows emails", () => {
    const page = readFileSync("src/app/(app)/owner/page.tsx", "utf8");
    expect(page).toContain("await requireOwner()");
    const board = readFileSync("src/app/(app)/owner/OwnerDashboard.tsx", "utf8");
    expect(board).not.toMatch(/\/media\/|\/reference\/|email/i);
    const queries = readFileSync("src/lib/owner/queries.ts", "utf8");
    expect(queries.startsWith('import "server-only";')).toBe(true);
  });
});
