import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertIcon, CheckIcon } from "@/components/Icons";
import { JobSummary, JobWorkflowOutline } from "@/components/JobDetails";
import JobTeam from "@/components/JobTeam";
import TeamActionButton from "@/components/TeamActionButton";
import { requireUser } from "@/lib/dal";
import { getJobDetail } from "@/lib/jobs/queries";
import { teamActionFor } from "@/lib/jobs/team";

export const metadata: Metadata = {
  title: "Job · Armour Ops",
};

// Job view for everyone. Employees can claim an available job or join one in
// progress when allowed; everyone else sees it read only. Step work arrives in
// Phase 5.
export default async function JobPage({ params }: PageProps<"/jobs/[jobId]">) {
  const user = await requireUser();
  const { jobId } = await params;
  const result = await getJobDetail(jobId);
  if (result.status === "missing") notFound();

  if (result.status === "error") {
    return (
      <>
        <BackLink />
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          This job couldn’t be loaded. Refresh to try again.
        </p>
      </>
    );
  }

  const { detail } = result;
  const action = teamActionFor({
    status: detail.job.status,
    allowEmployeesToJoin: detail.job.allow_employees_to_join,
    team: detail.card.team,
    userId: user.id,
    userRole: user.role,
  });

  return (
    <>
      <BackLink />
      <JobSummary detail={detail} />

      <div className="mt-4">
        {action.kind === "claim" && <TeamActionButton jobId={detail.job.id} kind="claim" />}
        {action.kind === "join" && <TeamActionButton jobId={detail.job.id} kind="join" />}
        {action.kind === "on_team" && (
          <p className="flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] font-medium text-emerald-200">
            <CheckIcon className="h-5 w-5 shrink-0" />
            You’re on this job. Step-by-step work opens in the next update.
          </p>
        )}
        {action.kind === "none" && action.message && (
          <p className="rounded-2xl border border-sky-400/30 bg-sky-400/10 p-4 text-[15px] leading-relaxed text-sky-100">
            {action.message}
          </p>
        )}
      </div>

      <JobTeam team={detail.card.team} currentUserId={user.id} />
      <JobWorkflowOutline detail={detail} />
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/jobs"
      className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300"
    >
      ← All jobs
    </Link>
  );
}
