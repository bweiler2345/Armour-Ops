import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPLOYEE_SECTIONS, employeeSectionFor, groupJobsForEmployee, type SectionJob } from "./sections";
import { JOB_STATUSES, type JobStatus } from "./status";

const ME = "11111111-1111-4111-8111-111111111111";

function job(id: string, status: JobStatus, extra: Partial<SectionJob> = {}): SectionJob {
  return {
    id,
    status,
    scheduledDate: "2026-10-15",
    lastActivityAt: "2026-09-27T12:00:00Z",
    completedAt: null,
    teamIds: [],
    ...extra,
  };
}

describe("employee Jobs screen sections", () => {
  it("are the spec's sections in the spec's order", () => {
    const spec = readFileSync("docs/PRODUCT_SPEC.md", "utf8").replaceAll("\r\n", "\n");
    const block = spec.split("The employee Jobs screen contains:\n\n")[1].split("\n\n")[0];
    const specTitles = block.split("\n").map((line) => line.replace(/^- /, "").replace(/[:.].*$/, ""));
    expect(EMPLOYEE_SECTIONS.map((s) => s.title)).toEqual(specTitles);
  });

  it("place every status in the right section", () => {
    const expected: Record<JobStatus, string> = {
      scheduled: "scheduled",
      available_to_claim: "available",
      claimed: "other_active",
      initial_prep_in_progress: "other_active",
      waiting_for_base_coat_installation: "other_active",
      base_coat_installed: "other_active",
      top_coat_prep_in_progress: "other_active",
      waiting_for_top_coat_installation: "other_active",
      top_coat_installed: "other_active",
      completion_work_in_progress: "other_active",
      complete: "completed",
    };
    for (const status of JOB_STATUSES) {
      expect(employeeSectionFor(job("a", status), ME), status).toBe(expected[status]);
    }
  });

  it("put jobs the employee is on under My Current Jobs until complete", () => {
    expect(employeeSectionFor(job("a", "initial_prep_in_progress", { teamIds: [ME] }), ME)).toBe("mine");
    expect(employeeSectionFor(job("a", "complete", { teamIds: [ME] }), ME)).toBe("completed");
  });

  it("show Scheduled jobs to employees in their own section", () => {
    const sections = groupJobsForEmployee([job("s", "scheduled")], ME);
    expect(sections.find((s) => s.key === "scheduled")?.jobs.map((j) => j.id)).toEqual(["s"]);
  });

  it("sort upcoming jobs by date and the rest by recent activity", () => {
    const sections = groupJobsForEmployee(
      [
        job("late", "scheduled", { scheduledDate: "2026-11-02" }),
        job("soon", "scheduled", { scheduledDate: "2026-10-01" }),
        job("old", "claimed", { lastActivityAt: "2026-09-01T00:00:00Z" }),
        job("new", "claimed", { lastActivityAt: "2026-09-20T00:00:00Z" }),
      ],
      ME,
    );
    const ids = (key: string) => sections.find((s) => s.key === key)?.jobs.map((j) => j.id);
    expect(ids("scheduled")).toEqual(["soon", "late"]);
    expect(ids("other_active")).toEqual(["new", "old"]);
  });

  it("give every section a clear empty message", () => {
    const sections = groupJobsForEmployee([], ME);
    expect(sections).toHaveLength(5);
    for (const section of sections) {
      expect(section.jobs).toEqual([]);
      expect(section.emptyText.length, section.key).toBeGreaterThan(10);
    }
    expect(new Set(sections.map((s) => s.emptyText)).size).toBe(5);
  });
});
