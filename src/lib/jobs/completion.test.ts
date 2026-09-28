import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { employeeSectionFor, ownerGroupFor, type SectionJob } from "./sections";
import { JOB_STATUS_LABELS, milestoneState, type JobStatus } from "./status";

const ME = "11111111-1111-4111-8111-111111111111";

const job = (status: JobStatus, overrides: Partial<SectionJob> & { id?: string } = {}): SectionJob & { id: string } => ({
  id: overrides.id ?? status,
  status,
  scheduledDate: "2026-10-20",
  lastActivityAt: "2026-10-20T12:00:00Z",
  completedAt: status === "complete" ? "2026-10-25T12:00:00Z" : null,
  teamIds: [ME],
  readyForOwnerCompletion: false,
  ...overrides,
});

describe("job cards move between sections as the job advances", () => {
  const path: [JobStatus, boolean, string, string][] = [
    ["initial_prep_in_progress", false, "in_progress", "mine"],
    ["waiting_for_base_coat_installation", false, "needs_owner", "mine"],
    ["base_coat_installed", false, "in_progress", "mine"],
    ["top_coat_prep_in_progress", false, "in_progress", "mine"],
    ["waiting_for_top_coat_installation", false, "needs_owner", "mine"],
    ["top_coat_installed", false, "in_progress", "mine"],
    ["completion_work_in_progress", false, "in_progress", "mine"],
    ["completion_work_in_progress", true, "needs_owner", "mine"],
    ["top_coat_installed", true, "needs_owner", "mine"],
    ["complete", false, "complete", "completed"],
  ];

  it.each(path)("%s (ready: %s) → owner %s, team member %s", (status, ready, owner, employee) => {
    const j = job(status, { readyForOwnerCompletion: ready });
    expect(ownerGroupFor(j)).toBe(owner);
    expect(employeeSectionFor(j, ME)).toBe(employee);
  });

  it("shows jobs the employee isn't on as other active jobs until they're complete", () => {
    expect(employeeSectionFor(job("waiting_for_top_coat_installation", { teamIds: [] }), ME)).toBe("other_active");
    expect(employeeSectionFor(job("complete", { teamIds: [] }), ME)).toBe("completed");
  });
});

// Owner Dashboard counts and ordering: src/lib/owner/dashboard.test.ts.

describe("milestone states shown on the workflow map", () => {
  it("follow the job status", () => {
    expect(milestoneState("waiting_for_base_coat_installation", "base_coat_installation")).toBe("waiting");
    expect(milestoneState("base_coat_installed", "base_coat_installation")).toBe("installed");
    expect(milestoneState("base_coat_installed", "top_coat_installation")).toBe("upcoming");
    expect(milestoneState("top_coat_installed", "top_coat_installation")).toBe("installed");
    expect(milestoneState("complete", "base_coat_installation")).toBe("installed");
  });

  it("use the exact installation status names", () => {
    expect(JOB_STATUS_LABELS.waiting_for_base_coat_installation).toBe("Waiting for Base-Coat Installation");
    expect(JOB_STATUS_LABELS.base_coat_installed).toBe("Base Coat Installed");
    expect(JOB_STATUS_LABELS.waiting_for_top_coat_installation).toBe("Waiting for Top-Coat Installation");
    expect(JOB_STATUS_LABELS.top_coat_installed).toBe("Top Coat Installed");
    expect(JOB_STATUS_LABELS.completion_work_in_progress).toBe("Completion Work in Progress");
  });
});

describe("installation terminology", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx|sql|md|mjs)$/.test(name) ? [path] : [];
    });
  }

  it("never uses pour, poured, or pouring in the app, database, or docs", () => {
    const checked = [...files("src"), ...files("supabase"), ...files("docs"), "README.md"].filter(
      // Tests name the forbidden word in order to check for it.
      (path) => !/\.test\.ts$/.test(path),
    );
    expect(checked.length).toBeGreaterThan(50);
    for (const path of checked) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/\bpour(s|ed|ing)?\b/i);
    }
  });

  it("uses the exact milestone button names", () => {
    const actions = readFileSync("src/app/(app)/owner/jobs/OwnerJobActions.tsx", "utf8");
    for (const label of ["Mark Base Coat Installed", "Mark Top Coat Installed", "Mark Job Complete"]) {
      expect(actions).toContain(`"${label}"`);
    }
  });
});
