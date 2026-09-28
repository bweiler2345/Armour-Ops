import { isActiveStatus, type JobStatus } from "./status";

// Who is on a job team, and what the signed-in person may do about it. The
// database functions enforce the same rules; these only decide which
// buttons and messages to show.

export type TeamMember = {
  employeeId: string;
  name: string;
  role: "lead" | "member";
  active: boolean;
};

export function sortTeam(team: readonly TeamMember[]): TeamMember[] {
  return [...team].sort((a, b) => {
    if (a.role !== b.role) return a.role === "lead" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function teamLabel(member: TeamMember) {
  const name = member.name.trim() || "Unnamed employee";
  return member.role === "lead" ? `${name} (Lead)` : name;
}

// An owner working on the job (Owner/Working Member). Never the lead or an
// employee member.
export type WorkingOwner = { ownerId: string; name: string; active: boolean };

export const WORKING_OWNER_LABEL = "Owner · Working Member";

export function workingOwnerLabel(owner: WorkingOwner) {
  return `${owner.name.trim() || "Owner"} (${WORKING_OWNER_LABEL})`;
}

// Everyone shown on a job card: lead first, then members, then working owners.
export function teamNamesWithOwners(team: readonly TeamMember[], owners: readonly WorkingOwner[]) {
  return [
    ...sortTeam(team).map(teamLabel),
    ...[...owners].sort((a, b) => a.name.localeCompare(b.name)).map(workingOwnerLabel),
  ];
}

export type TeamAction =
  | { kind: "claim" }
  | { kind: "join" }
  | { kind: "on_team" }
  | { kind: "none"; message: string | null };

export function teamActionFor(input: {
  status: JobStatus;
  allowEmployeesToJoin: boolean;
  team: readonly TeamMember[];
  userId: string;
  userRole: "owner" | "employee";
}): TeamAction {
  const { status, team, userId } = input;
  if (team.some((m) => m.employeeId === userId)) return { kind: "on_team" };
  // Owners manage teams from the owner job page instead.
  if (input.userRole !== "employee") return { kind: "none", message: null };

  if (status === "available_to_claim") return { kind: "claim" };
  if (status === "scheduled") {
    return {
      kind: "none",
      message: "Not available yet. The owner will make this job available when it’s ready to claim.",
    };
  }
  if (status === "complete") return { kind: "none", message: null };

  if (isActiveStatus(status)) {
    if (!input.allowEmployeesToJoin) {
      return {
        kind: "none",
        message: "The owner has turned off joining for this job. Ask the owner to add you.",
      };
    }
    if (!team.some((m) => m.role === "lead")) {
      return { kind: "none", message: "This job has no lead right now. Ask the owner to add you." };
    }
    return { kind: "join" };
  }
  return { kind: "none", message: null };
}
