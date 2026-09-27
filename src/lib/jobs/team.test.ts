import { describe, expect, it } from "vitest";
import { jobErrorMessage } from "./errors";
import { groupJobsForEmployee, type SectionJob } from "./sections";
import { sortTeam, teamActionFor, teamLabel, type TeamMember } from "./team";

const ME = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const lead: TeamMember = { employeeId: LEAD, name: "Sample Lead", role: "lead", active: true };

const base = {
  allowEmployeesToJoin: true,
  team: [lead],
  userId: ME,
  userRole: "employee" as const,
};

describe("what an employee can do on a job", () => {
  it("offers Claim Job on Available jobs", () => {
    expect(teamActionFor({ ...base, status: "available_to_claim", team: [] })).toEqual({ kind: "claim" });
  });

  it("offers Join Job on in-progress jobs when joining is on", () => {
    expect(teamActionFor({ ...base, status: "claimed" })).toEqual({ kind: "join" });
    expect(teamActionFor({ ...base, status: "top_coat_prep_in_progress" })).toEqual({ kind: "join" });
  });

  it("explains when joining is off", () => {
    const action = teamActionFor({ ...base, status: "claimed", allowEmployeesToJoin: false });
    expect(action).toEqual({
      kind: "none",
      message: "The owner has turned off joining for this job. Ask the owner to add you.",
    });
  });

  it("explains a job with no lead instead of offering Join", () => {
    const action = teamActionFor({ ...base, status: "claimed", team: [] });
    expect(action.kind).toBe("none");
  });

  it("shows Scheduled jobs as not available yet", () => {
    const action = teamActionFor({ ...base, status: "scheduled", team: [] });
    expect(action.kind === "none" && action.message).toMatch(/Not available yet/);
  });

  it("recognizes employees already on the team", () => {
    expect(teamActionFor({ ...base, status: "claimed", userId: LEAD })).toEqual({ kind: "on_team" });
  });

  it("offers nothing on complete jobs or to owners", () => {
    expect(teamActionFor({ ...base, status: "complete" })).toEqual({ kind: "none", message: null });
    expect(teamActionFor({ ...base, status: "available_to_claim", userRole: "owner" })).toEqual({
      kind: "none",
      message: null,
    });
  });
});

describe("team display", () => {
  it("lists the lead first, then members by name", () => {
    const team = sortTeam([
      { employeeId: "b", name: "Zed", role: "member", active: true },
      { employeeId: "c", name: "Amy", role: "member", active: true },
      lead,
    ]);
    expect(team.map((m) => m.name)).toEqual(["Sample Lead", "Amy", "Zed"]);
    expect(team.map(teamLabel)).toEqual(["Sample Lead (Lead)", "Amy", "Zed"]);
  });
});

describe("My Current Jobs uses real assignments", () => {
  const job = (id: string, teamIds: string[]): SectionJob => ({
    id,
    status: "initial_prep_in_progress",
    scheduledDate: "2026-10-15",
    lastActivityAt: "2026-09-27T12:00:00Z",
    completedAt: null,
    teamIds,
  });

  it("puts jobs the employee is on in My Current Jobs and others in Other Active Jobs", () => {
    const sections = groupJobsForEmployee([job("mine", [LEAD, ME]), job("theirs", [LEAD])], ME);
    const ids = (key: string) => sections.find((s) => s.key === key)?.jobs.map((j) => j.id);
    expect(ids("mine")).toEqual(["mine"]);
    expect(ids("other_active")).toEqual(["theirs"]);
  });

  it("shows several current jobs for one employee", () => {
    const sections = groupJobsForEmployee([job("a", [ME]), job("b", [ME])], ME);
    expect(sections.find((s) => s.key === "mine")?.jobs).toHaveLength(2);
  });
});

describe("team error messages", () => {
  it("shows role messages from our own checks", () => {
    expect(jobErrorMessage({ code: "42501", message: "Only an active employee can do this." })).toBe(
      "Only an active employee can do this.",
    );
    expect(jobErrorMessage({ code: "42501", message: "permission denied for table jobs" })).toBe(
      "Only an active owner can do this.",
    );
    expect(jobErrorMessage({ code: "P0001", message: "Someone else claimed this job first." })).toBe(
      "Someone else claimed this job first.",
    );
  });
});
