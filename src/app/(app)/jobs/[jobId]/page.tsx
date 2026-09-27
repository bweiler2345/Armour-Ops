import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { AlertIcon, CheckIcon, ChevronRightIcon, KeyIcon } from "@/components/Icons";
import { JobSummary } from "@/components/JobDetails";
import JobTeam from "@/components/JobTeam";
import TeamActionButton from "@/components/TeamActionButton";
import WorkflowMap from "@/components/WorkflowMap";
import { requireUser } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
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

      <StageNotice detail={detail} onTeam={action.kind === "on_team"} />

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
            !hasStageNotice(detail) && (
              <p className="flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] font-medium text-emerald-200">
                <CheckIcon className="h-5 w-5 shrink-0" />
                You’re on this job. No step is open right now.
              </p>
            )
          ))}
        {action.kind === "none" && action.message && (
          <p className="rounded-2xl border border-sky-400/30 bg-sky-400/10 p-4 text-[15px] leading-relaxed text-sky-100">
            {action.message}
          </p>
        )}
      </div>

      <JobTeam team={detail.card.team} currentUserId={user.id} workingOwners={detail.workingOwners} />
      <WorkflowMap detail={detail} statuses={statuses} />
      {detail.job.status !== "complete" && <AutoRefresh everyMs={15_000} />}
    </>
  );
}

type Detail = Extract<Awaited<ReturnType<typeof getJobDetail>>, { status: "ok" }>["detail"];

function hasStageNotice(detail: Detail) {
  const { status } = detail.job;
  return (
    status === "waiting_for_base_coat_installation" ||
    status === "waiting_for_top_coat_installation" ||
    status === "complete" ||
    detail.card.readyForOwnerCompletion
  );
}

// Where the job stands when the next move is the owner's, or it's done.
// Employees text the owner when a job is ready for an installation.
function StageNotice({ detail, onTeam }: { detail: Detail; onTeam: boolean }) {
  const { job } = detail;
  if (job.status === "complete") {
    return (
      <p className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] leading-relaxed font-medium text-emerald-100">
        <CheckIcon className="mt-0.5 h-5 w-5 shrink-0" />
        <span>
          Complete{job.completed_at ? ` · ${formatDateTime(job.completed_at)}` : ""}. This job is read only.
        </span>
      </p>
    );
  }
  const waiting =
    job.status === "waiting_for_base_coat_installation"
      ? { what: "Base-Coat Installation", next: "Top-Coat Prep opens after the owner marks the base coat installed." }
      : job.status === "waiting_for_top_coat_installation"
        ? { what: "Top-Coat Installation", next: "Completion Work opens after the owner marks the top coat installed." }
        : null;
  if (waiting) {
    return (
      <div className="mt-4 rounded-2xl border border-gold-500/50 bg-gold-900/40 p-4">
        <p className="flex items-center gap-2 text-[16px] font-semibold text-white">
          <KeyIcon className="h-5 w-5 shrink-0 text-gold-300" /> Waiting for owner: {waiting.what}
        </p>
        <p className="mt-1 text-[15px] leading-relaxed text-charcoal-300">
          {waiting.next}
          {onTeam ? " If you haven’t yet, text the owner that the job is ready." : ""}
        </p>
      </div>
    );
  }
  if (detail.card.readyForOwnerCompletion) {
    return (
      <div className="mt-4 rounded-2xl border border-gold-500/50 bg-gold-900/40 p-4">
        <p className="flex items-center gap-2 text-[16px] font-semibold text-white">
          <CheckIcon className="h-5 w-5 shrink-0 text-gold-300" /> All work done: waiting for owner
        </p>
        <p className="mt-1 text-[15px] leading-relaxed text-charcoal-300">
          Both installations and all Completion Work are done. The owner reviews the job and marks it Complete.
        </p>
      </div>
    );
  }
  return null;
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
