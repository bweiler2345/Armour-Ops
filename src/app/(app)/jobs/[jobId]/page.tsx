import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { AlertIcon, CheckIcon, ChevronRightIcon } from "@/components/Icons";
import { JobSummary } from "@/components/JobDetails";
import JobTeam from "@/components/JobTeam";
import TeamActionButton from "@/components/TeamActionButton";
import WorkflowMap from "@/components/WorkflowMap";
import { requireUser } from "@/lib/dal";
import { getJobDetail } from "@/lib/jobs/queries";
import { teamActionFor } from "@/lib/jobs/team";
import { getJobStepStatuses } from "@/lib/steps/queries";

export const metadata: Metadata = {
  title: "Job · Armour Ops",
};

// Job view for everyone. Employees can claim an available job or join one in
// progress when allowed, and team members continue to the current step.
// Everyone else sees it read only.
export default async function JobPage({ params }: PageProps<"/jobs/[jobId]">) {
  const user = await requireUser();
  const { jobId } = await params;
  const [result, statuses] = await Promise.all([getJobDetail(jobId), getJobStepStatuses(jobId)]);
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
  // The first open step, in workflow order.
  const current = detail.stages
    .flatMap((stage) => stage.steps)
    .find((step) => {
      const state = statuses?.get(step.id)?.state;
      return state === "available" || state === "in_progress";
    });

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
        {action.kind === "on_team" &&
          (current ? (
            <Link
              href={`/jobs/${detail.job.id}/steps/${current.id}`}
              className="gold-gradient flex min-h-16 items-center justify-center gap-2 rounded-2xl px-4 text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 active:scale-[0.98]"
            >
              Continue: {current.title}
              <ChevronRightIcon className="h-6 w-6 shrink-0" />
            </Link>
          ) : (
            <p className="flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] font-medium text-emerald-200">
              <CheckIcon className="h-5 w-5 shrink-0" />
              You’re on this job. No step is open right now.
            </p>
          ))}
        {action.kind === "none" && action.message && (
          <p className="rounded-2xl border border-sky-400/30 bg-sky-400/10 p-4 text-[15px] leading-relaxed text-sky-100">
            {action.message}
          </p>
        )}
      </div>

      <JobTeam team={detail.card.team} currentUserId={user.id} />
      <WorkflowMap detail={detail} statuses={statuses} />
      {detail.job.status !== "complete" && <AutoRefresh everyMs={15_000} />}
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
