import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import ConfirmAction from "@/components/ConfirmAction";
import { AlertIcon, CheckIcon, KeyIcon } from "@/components/Icons";
import { JobSummary } from "@/components/JobDetails";
import { SectionHeading } from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { describeActivity } from "@/lib/jobs/activity";
import { isActiveStatus } from "@/lib/jobs/status";
import { removeCustomStep } from "@/lib/actions/custom-steps";
import { setWorkingMembership } from "@/lib/actions/owner";
import {
  getJobActivity,
  getJobDetail,
  listActiveEmployees,
  type JobActivityEntry,
} from "@/lib/jobs/queries";
import JobStatusControls from "../JobStatusControls";
import OwnerJobActions from "../OwnerJobActions";
import OwnerTeamPanel from "../OwnerTeamPanel";
import WorkflowMap from "@/components/WorkflowMap";
import { getJobStepStatuses } from "@/lib/steps/queries";

export const metadata: Metadata = {
  title: "Manage Job · Armour Ops",
};

export default async function OwnerJobPage({ params }: PageProps<"/owner/jobs/[jobId]">) {
  const user = await requireOwner();
  const { jobId } = await params;
  const [result, activity, employees, statuses] = await Promise.all([
    getJobDetail(jobId),
    getJobActivity(jobId),
    listActiveEmployees(),
    getJobStepStatuses(jobId),
  ]);
  if (result.status === "missing") notFound();

  if (result.status === "error") {
    return (
      <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
        <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
        This job couldn’t be loaded. Refresh to try again.
      </p>
    );
  }

  const { detail } = result;
  const { job } = detail;
  // While a reopened step waits to be redone, installations and completion wait too.
  const reopened = detail.card.reopenedStepTitle;
  const working = detail.workingOwners.some((w) => w.ownerId === user.id);
  const customSteps = detail.stages.flatMap((stage) =>
    stage.steps.filter((s) => s.origin !== "standard").map((s) => ({ ...s, stageName: stage.name })),
  );

  return (
    <>
      <Link
        href="/owner/jobs"
        className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300"
      >
        ← Jobs
      </Link>

      <JobSummary detail={detail} />

      <div className="mt-4 flex flex-col gap-3">
        {reopened && (
          <p className="flex items-start gap-3 rounded-2xl border border-gold-500/50 bg-gold-900/40 p-4 text-[15px] leading-relaxed font-medium text-white">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold-300" />
            <span>
              Reopened: “{reopened}”. The team redoes it first; installations and Mark Job Complete wait until it’s
              complete again.
            </span>
          </p>
        )}
        {!reopened && job.status === "waiting_for_base_coat_installation" && (
          <OwnerStep
            title="Waiting for you: Base-Coat Installation"
            text="Initial Prep is complete. After you install the base coat, mark it installed to open Top-Coat Prep to the team."
          >
            <OwnerJobActions jobId={job.id} kind="base_coat" />
          </OwnerStep>
        )}
        {!reopened && job.status === "waiting_for_top_coat_installation" && (
          <OwnerStep
            title="Waiting for you: Top-Coat Installation"
            text="Top-Coat Prep is complete. After you install the top coat, mark it installed to open Completion Work to the team."
          >
            <OwnerJobActions jobId={job.id} kind="top_coat" />
          </OwnerStep>
        )}
        {detail.card.readyForOwnerCompletion && job.status !== "complete" && (
          <OwnerStep
            title="Ready for your review"
            text="Both installations and all applicable Completion Work are done. Review the steps, proof, and history below, then mark the job Complete."
          >
            <OwnerJobActions jobId={job.id} kind="complete" />
          </OwnerStep>
        )}
        {job.status === "complete" && (
          <p className="flex items-start gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] leading-relaxed font-medium text-emerald-100">
            <CheckIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              Complete{job.completed_at ? ` · ${formatDateTime(job.completed_at)}` : ""}. This job is read only.
              {job.media_delete_after && (
                <>
                  {" "}Its pictures and videos are kept until at least {formatDateTime(job.media_delete_after)}.
                </>
              )}
            </span>
          </p>
        )}
        {job.status === "scheduled" && (
          <>
            <JobStatusControls jobId={job.id} change="make_available" />
            <Link
              href={`/owner/jobs/${job.id}/edit`}
              className="flex min-h-16 w-full items-center justify-center rounded-2xl border border-gold-500/50 bg-charcoal-800 text-lg font-semibold text-gold-300 transition hover:bg-charcoal-700 active:scale-[0.98]"
            >
              Edit Details
            </Link>
          </>
        )}
        {job.status === "available_to_claim" && (
          <>
            <p className="text-[15px] leading-relaxed text-charcoal-300">
              Employees can see this job as available. To change its details, return it to
              Scheduled first.
            </p>
            <JobStatusControls jobId={job.id} change="return_to_scheduled" />
          </>
        )}
      </div>

      <OwnerTeamPanel
        jobId={job.id}
        status={job.status}
        allowEmployeesToJoin={job.allow_employees_to_join}
        team={detail.card.team}
        employees={employees}
        workingOwners={detail.workingOwners}
        currentUserId={user.id}
      />

      {isActiveStatus(job.status) && (
        <section aria-labelledby="working-team" className="mt-8">
          <SectionHeading id="working-team" title="Working on this job" />
          <p className="mb-3 text-[15px] leading-relaxed text-charcoal-300">
            {working
              ? "You’re on the working team as Owner · Working Member. You can work steps like the crew; the employee lead stays the lead."
              : "Join the working team to check items, fill in entries, upload proof, and complete steps yourself. The employee lead stays the lead. Without joining, you can view employee work but not change it."}
          </p>
          {working ? (
            <ConfirmAction
              action={setWorkingMembership.bind(null, job.id, false)}
              label="Leave Working Team"
              title="Leave the working team?"
              body="Your owner access and the employee lead don’t change, and everything you did stays in the job’s history. Leave any step you’re editing first."
              confirmLabel="Leave"
              busyLabel="Leaving…"
            />
          ) : (
            <ConfirmAction
              action={setWorkingMembership.bind(null, job.id, true)}
              label="Join Job as Working Owner"
              title="Join as a Working Owner?"
              body="You’ll be able to work this job’s steps, and your name is recorded on everything you do. The employee lead stays the lead."
              confirmLabel="Join"
              busyLabel="Joining…"
              tone="primary"
            />
          )}
        </section>
      )}

      {job.status !== "complete" && (
        <section aria-labelledby="custom-steps" className="mt-8">
          <SectionHeading id="custom-steps" title="Custom steps" count={customSteps.length} />
          {customSteps.length > 0 && (
            <ul className="mb-3 flex flex-col gap-2">
              {customSteps.map((step) => (
                <li key={step.id} className="rounded-2xl border border-charcoal-800 bg-charcoal-900 p-4">
                  <p className="text-[16px] font-semibold text-white">{step.title}</p>
                  <p className="text-sm text-charcoal-400">
                    {step.origin === "library" ? "Imported library step" : "One-time custom step"} · {step.stageName}
                  </p>
                  {(job.status === "scheduled" || job.status === "available_to_claim") && (
                    <div className="mt-3">
                      <ConfirmAction
                        action={removeCustomStep.bind(null, job.id, step.id)}
                        label="Remove"
                        title={`Remove “${step.title}”?`}
                        body="Nobody has started it. It’s removed from this job only, and the removal is recorded in the job’s history."
                        confirmLabel="Remove"
                        busyLabel="Removing…"
                        tone="danger"
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/owner/jobs/${job.id}/steps/new`}
            className="flex min-h-16 items-center justify-center rounded-2xl border border-gold-500/50 bg-charcoal-800 text-lg font-semibold text-gold-200"
          >
            Add Custom Step
          </Link>
        </section>
      )}

      <WorkflowMap detail={detail} statuses={statuses} />
      {job.status !== "complete" && <AutoRefresh everyMs={30_000} />}

      <section aria-labelledby="job-history" className="mt-8">
        <SectionHeading id="job-history" title="History" />
        {activity === null ? (
          <p className="text-[15px] text-charcoal-400">History couldn’t be loaded.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {activity.map((entry) => (
              <HistoryEntry key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs break-all text-charcoal-400">
          Workflow {job.workflow_key} v{job.workflow_version} · fingerprint{" "}
          {job.workflow_content_sha256.slice(0, 12)}
        </p>
      </section>
    </>
  );
}

function OwnerStep({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-gold-500/60 bg-gold-900/30 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
        <KeyIcon className="h-5 w-5 shrink-0 text-gold-300" />
        {title}
      </h2>
      <p className="mt-1 mb-4 text-[15px] leading-relaxed text-charcoal-300">{text}</p>
      {children}
    </section>
  );
}

function HistoryEntry({ entry }: { entry: JobActivityEntry }) {
  const { title, changes } = describeActivity(entry);

  return (
    <li className="rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3">
      <p className="text-[15px] font-medium text-white">{title}</p>
      {changes.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 text-sm break-words text-charcoal-300">
          {changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-sm text-charcoal-400">{formatDateTime(entry.createdAt)}</p>
    </li>
  );
}
