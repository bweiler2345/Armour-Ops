import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { AlertIcon, CheckIcon, KeyIcon } from "@/components/Icons";
import { JobSummary } from "@/components/JobDetails";
import { SectionHeading } from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/jobs/status";
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
  await requireOwner();
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
        {job.status === "waiting_for_base_coat_installation" && (
          <OwnerStep
            title="Waiting for you: Base-Coat Installation"
            text="Initial Prep is complete. After you install the base coat, mark it installed to open Top-Coat Prep to the team."
          >
            <OwnerJobActions jobId={job.id} kind="base_coat" />
          </OwnerStep>
        )}
        {job.status === "waiting_for_top_coat_installation" && (
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
      />

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

const FIELD_LABELS: Record<string, string> = {
  client_name: "Client name",
  address: "Address",
  square_feet: "Square footage",
  flake_color: "Flake color",
  scheduled_date: "Scheduled date",
  general_notes: "Notes",
  caulking_required: "Caulking",
  baseboard_required: "Baseboard",
  allow_employees_to_join: "Allow Employees to Join",
};

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

function describeValue(value: unknown) {
  if (value === true) return "on";
  if (value === false) return "off";
  if (value === "" || value === null || value === undefined) return "(blank)";
  return String(value);
}

function HistoryEntry({ entry }: { entry: JobActivityEntry }) {
  const who = entry.actorName || "Someone";
  const details = (entry.details ?? {}) as Record<string, unknown>;
  const person = (key: string) => {
    const id = details[key];
    return (typeof id === "string" && entry.names[id]) || "an employee";
  };
  let title: string;
  let changes: string[] = [];

  switch (entry.type) {
    case "job_created":
      title = `${who} created the job (workflow version ${String(details.workflow_version ?? "?")})`;
      break;
    case "job_details_edited": {
      title = `${who} edited the job details`;
      const edits = (details.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
      changes = Object.entries(edits).map(
        ([field, change]) =>
          `${FIELD_LABELS[field] ?? field}: ${describeValue(change.from)} → ${describeValue(change.to)}`,
      );
      break;
    }
    case "made_available":
      title = `${who} made the job available to claim`;
      break;
    case "claimed":
      title = `${who} claimed the job and became the lead`;
      break;
    case "employee_joined":
      title = `${who} joined the job`;
      break;
    case "employee_added":
      title = `${who} added ${person("employee_id")}${details.role === "lead" ? " as lead" : ""}`;
      break;
    case "employee_removed":
      title = `${who} removed ${person("employee_id")}${details.role === "lead" ? " (lead)" : ""}`;
      break;
    case "lead_changed":
      title = details.from_employee_id
        ? `${who} changed the lead from ${person("from_employee_id")} to ${person("to_employee_id")}`
        : `${who} made ${person("to_employee_id")} the lead`;
      break;
    case "step_started":
      title = `${who} started “${String(details.title ?? "a step")}”`;
      break;
    case "step_completed":
      title = `${who} completed “${String(details.title ?? "a step")}”`;
      break;
    case "milestone_installed":
      title = `${who} marked ${String(details.label ?? "an installation milestone")}`;
      break;
    case "job_completed":
      title = `${who} marked the job Complete`;
      break;
    case "proof_uploaded":
      title = `${who} uploaded proof: ${String(details.proof ?? "a file")}`;
      break;
    case "proof_removed":
      title = `${who} removed proof: ${String(details.proof ?? "a file")}`;
      break;
    case "status_changed":
      title = `Status changed to ${JOB_STATUS_LABELS[details.to as JobStatus] ?? String(details.to)}`;
      break;
    case "step_hold_cleared":
      title = `${who} cleared ${person("employee_id")}’s edit hold on “${String(details.title ?? "a step")}”`;
      break;
    case "join_setting_changed":
      title = `${who} turned Allow Employees to Join ${details.to ? "on" : "off"}`;
      break;
    case "returned_to_scheduled":
      title = `${who} returned the job to Scheduled`;
      break;
    default:
      title = `${who} updated the job`;
  }

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
