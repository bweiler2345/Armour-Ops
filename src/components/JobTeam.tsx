import { SectionHeading } from "@/components/PageHeading";
import { WORKING_OWNER_LABEL, type TeamMember, type WorkingOwner } from "@/lib/jobs/team";

// Read-only job team: lead first, then members, then any owners working on
// the job (Owner/Working Member, never the lead).
export default function JobTeam({
  team,
  currentUserId,
  workingOwners = [],
}: {
  team: readonly TeamMember[];
  currentUserId: string;
  workingOwners?: readonly WorkingOwner[];
}) {
  return (
    <section aria-labelledby="job-team" className="mt-8">
      <SectionHeading id="job-team" title="Team" count={team.length + workingOwners.length} />
      {team.length === 0 && workingOwners.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-charcoal-700 p-5 text-center text-[15px] text-charcoal-400">
          No one is assigned to this job yet.
        </p>
      ) : (
        team.length > 0 && <ul className="flex flex-col gap-2">
          {team.map((member) => (
            <li
              key={member.employeeId}
              className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3"
            >
              <span className="min-w-0 text-[17px] font-semibold break-words text-white">
                {member.name.trim() || "Unnamed employee"}
                {member.employeeId === currentUserId && (
                  <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-charcoal-300">
                    You
                  </span>
                )}
                {!member.active && (
                  <span className="ml-2 text-sm font-normal text-red-300">Deactivated</span>
                )}
              </span>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                  member.role === "lead"
                    ? "bg-gold-400/15 text-gold-300 ring-gold-400/40"
                    : "bg-white/5 text-charcoal-300 ring-white/15"
                }`}
              >
                {member.role === "lead" ? "Lead" : "Member"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <WorkingOwnerRows owners={workingOwners} currentUserId={currentUserId} />
    </section>
  );
}

// Owners working on the job, labeled "Owner · Working Member" and kept apart
// from the employee lead and members. Shared by every job-team display.
export function WorkingOwnerRows({
  owners,
  currentUserId,
}: {
  owners: readonly WorkingOwner[];
  currentUserId?: string;
}) {
  if (owners.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {owners.map((owner) => (
        <li
          key={owner.ownerId}
          className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3"
        >
          <span className="min-w-0 text-[17px] font-semibold break-words text-white">
            {owner.name}
            {owner.ownerId === currentUserId && (
              <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-charcoal-300">You</span>
            )}
            {!owner.active && <span className="ml-2 text-sm font-normal text-red-300">Deactivated</span>}
          </span>
          <span className="shrink-0 rounded-full bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-200 ring-1 ring-sky-400/30">
            {WORKING_OWNER_LABEL}
          </span>
        </li>
      ))}
    </ul>
  );
}
