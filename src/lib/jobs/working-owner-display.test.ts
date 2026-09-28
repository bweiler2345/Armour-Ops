import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { teamNamesWithOwners, WORKING_OWNER_LABEL, workingOwnerLabel, type TeamMember } from "./team";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

const lead: TeamMember = { employeeId: "e1", name: "Sample Lead", role: "lead", active: true };
const member: TeamMember = { employeeId: "e2", name: "Sample Member", role: "member", active: true };
const owner = { ownerId: "o1", name: "Sample Owner", active: true };

describe("Working Owner on job-team displays", () => {
  it("labels the owner exactly and keeps the employee lead as Lead", () => {
    expect(WORKING_OWNER_LABEL).toBe("Owner · Working Member");
    expect(workingOwnerLabel(owner)).toBe("Sample Owner (Owner · Working Member)");
    expect(teamNamesWithOwners([member, lead], [owner])).toEqual([
      "Sample Lead (Lead)",
      "Sample Member",
      "Sample Owner (Owner · Working Member)",
    ]);
    expect(teamNamesWithOwners([lead], [])).toEqual(["Sample Lead (Lead)"]);
  });

  it("puts the working owner in job-card team data, apart from the employee team", async () => {
    const { toJobCard } = await import("./queries");
    const job = {
      id: "j1",
      job_number: 1001,
      client_name: "Sample Client",
      address: "1 Sample Road",
      square_feet: 500,
      flake_color: "Sample",
      scheduled_date: "2026-10-20",
      status: "initial_prep_in_progress",
      last_activity_at: "2026-10-20T12:00:00Z",
      completed_at: null,
    } as Parameters<typeof toJobCard>[0];
    const card = toJobCard(
      job,
      undefined,
      [{ job_id: "j1", employee_id: "e1", role: "lead", method: "claimed", assigned_at: "", full_name: "Sample Lead", employee_active: true }],
      [{ job_id: "j1", owner_id: "o1", full_name: "Sample Owner", joined_at: "", owner_active: true }],
    );
    expect(card.team).toEqual([lead]);
    expect(card.teamIds).toEqual(["e1"]);
    expect(card.workingOwners).toEqual([owner]);
    expect(card.teamNames).toEqual(["Sample Lead (Lead)", "Sample Owner (Owner · Working Member)"]);
  });

  it("shows working owners on the employee job page, the owner job page, and job cards", () => {
    const read = (path: string) => readFileSync(path, "utf8");
    expect(read("src/app/(app)/jobs/[jobId]/page.tsx")).toContain("workingOwners={detail.workingOwners}");
    expect(read("src/app/(app)/owner/jobs/[jobId]/page.tsx")).toContain("workingOwners={detail.workingOwners}");
    expect(read("src/app/(app)/owner/jobs/OwnerTeamPanel.tsx")).toContain("<WorkingOwnerRows");
    expect(read("src/components/JobTeam.tsx")).toContain("<WorkingOwnerRows");
    expect(read("src/components/JobCard.tsx")).toContain("job.teamNames");
  });
});
