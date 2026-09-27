import Link from "next/link";
import { CheckIcon, ChevronRightIcon, KeyIcon, LockIcon } from "@/components/Icons";
import { SectionHeading } from "@/components/PageHeading";
import { formatDateTime } from "@/lib/format";
import type { JobDetail } from "@/lib/jobs/queries";
import { milestoneState } from "@/lib/jobs/status";
import type { WorkflowStepStatus } from "@/lib/steps/queries";

// The job's workflow from its own snapshot: every stage in order, with a
// progress bar, each step's state, and the owner's installation milestones.
export default function WorkflowMap({
  detail,
  statuses,
}: {
  detail: JobDetail;
  statuses: Map<string, WorkflowStepStatus> | null;
}) {
  const { job } = detail;

  return (
    <section aria-labelledby="job-workflow" className="mt-8">
      <SectionHeading id="job-workflow" title="Workflow" />
      <p className="-mt-1 mb-4 text-sm text-charcoal-400">
        Workflow version {job.workflow_version}, copied when this job was created.
      </p>
      {statuses === null && (
        <p className="mb-4 text-[15px] text-red-200">Step progress couldn’t be loaded. Refresh to try again.</p>
      )}

      <ol className="flex flex-col gap-4">
        {detail.stages.map((stage, index) => {
          if (stage.kind === "owner_milestone") {
            const state = milestoneState(job.status, stage.key);
            const record = detail.milestones[stage.key];
            return (
              <li
                key={stage.id}
                className={`rounded-3xl border p-5 ${
                  state === "waiting"
                    ? "border-gold-500/60 bg-gold-900/40"
                    : state === "installed"
                      ? "border-emerald-400/30 bg-charcoal-900"
                      : "border-charcoal-800 bg-charcoal-900/60"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-lg font-semibold text-white">
                    {index + 1}. {stage.name}
                  </p>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-gold-300">
                    <KeyIcon className="h-4 w-4" /> Owner only
                  </span>
                </div>
                <p className="mt-1 text-[15px] text-charcoal-300">
                  {state === "installed"
                    ? record
                      ? `Installed by ${record.installedByName || "the owner"} · ${formatDateTime(record.installedAt)}`
                      : "Installed."
                    : state === "waiting"
                      ? `Waiting for the owner to select “${stage.ownerActionLabel}”.`
                      : "Done by the owner after the preparation stage before it."}
                </p>
              </li>
            );
          }

          // Completion Work items for options that are off are shown as Not
          // applicable and don't count toward progress.
          const steps = stage.steps;
          const applicable = steps.filter(
            (step) =>
              step.kind === "standard" ||
              (step.appliesWhen === "caulking_required" && job.caulking_required) ||
              (step.appliesWhen === "baseboard_required" && job.baseboard_required),
          );
          const done = applicable.filter((s) => statuses?.get(s.id)?.state === "completed").length;
          const percent = applicable.length ? Math.round((done / applicable.length) * 100) : 100;

          return (
            <li key={stage.id} className="overflow-hidden rounded-3xl border border-charcoal-800 bg-charcoal-900">
              <div className="p-5 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-lg font-semibold text-white">
                    {index + 1}. {stage.name}
                  </p>
                  <span className="text-sm font-semibold text-gold-300 tabular-nums">
                    {done} of {applicable.length}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-charcoal-700">
                  <div className="gold-gradient h-full rounded-full" style={{ width: `${percent}%` }} />
                </div>
              </div>

              {applicable.length === 0 && (
                <p className="px-5 pb-3 text-[15px] text-charcoal-300">
                  No Completion Work applies to this job. It’s ready for the owner once the top coat is installed.
                </p>
              )}
              {steps.length > 0 && (
                <ul className="divide-y divide-charcoal-800 border-t border-charcoal-800">
                  {steps.map((step, i) => (
                    <StepRow
                      key={step.id}
                      href={`/jobs/${job.id}/steps/${step.id}`}
                      number={i + 1}
                      title={step.title}
                      completionItem={step.kind === "completion_item"}
                      origin={step.origin}
                      optionLabel={step.appliesWhen === "baseboard_required" ? "Baseboard" : "Caulking"}
                      topCoatInstalled={milestoneState(job.status, "top_coat_installation") === "installed"}
                      status={statuses?.get(step.id)}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StepRow({
  href,
  number,
  title,
  completionItem,
  origin,
  optionLabel,
  topCoatInstalled,
  status,
}: {
  href: string;
  number: number;
  title: string;
  completionItem: boolean;
  origin: "standard" | "library" | "one_time";
  optionLabel: string;
  topCoatInstalled: boolean;
  status: WorkflowStepStatus | undefined;
}) {
  const state = status?.state ?? "locked";
  const current = state === "available" || state === "in_progress";

  const marker =
    state === "completed" ? (
      <span className="gold-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-charcoal-950">
        <CheckIcon className="h-5 w-5" />
      </span>
    ) : state === "not_applicable" ? (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-charcoal-800 text-lg font-bold text-charcoal-500">
        –
      </span>
    ) : current ? (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-gold-400 text-sm font-bold text-gold-300">
        {number}
      </span>
    ) : (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-charcoal-800 text-charcoal-500">
        <LockIcon className="h-4 w-4" />
      </span>
    );

  const sub =
    state === "completed"
      ? `Done by ${status?.completedByName || "a team member"}${status?.completedAt ? ` · ${formatDateTime(status.completedAt)}` : ""}`
      : state === "in_progress"
        ? status?.holdByName
          ? `In progress · ${status.holdByName} is editing`
          : "In progress"
        : state === "available"
          ? completionItem
            ? "Ready to mark complete"
            : "Ready to start"
          : state === "not_applicable"
            ? `Not applicable · ${optionLabel} is off for this job`
            : completionItem
              ? topCoatInstalled
                ? "Opens after the item above is complete"
                : "Opens after the top coat is installed"
              : "Locked";

  return (
    <li>
      <Link
        href={href}
        className={`flex min-h-16 items-center gap-3 px-5 py-3 transition active:bg-charcoal-800 ${
          current ? "bg-gold-900/30" : ""
        }`}
      >
        {marker}
        <span className="min-w-0 flex-1">
          <span className={`block text-[16px] font-semibold ${state === "locked" || state === "not_applicable" ? "text-charcoal-400" : "text-white"}`}>
            {title}
            {origin !== "standard" && (
              <span className="ml-2 rounded-full bg-sky-400/10 px-2 py-0.5 align-middle text-xs font-semibold text-sky-200">
                {origin === "library" ? "Library step" : "Custom step"}
              </span>
            )}
          </span>
          <span className={`block text-sm ${current ? "text-gold-300" : "text-charcoal-400"}`}>{sub}</span>
        </span>
        <ChevronRightIcon className="h-5 w-5 shrink-0 text-charcoal-500" />
      </Link>
    </li>
  );
}
