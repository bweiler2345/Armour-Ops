import { CalendarIcon, KeyIcon, MapPinIcon, RulerIcon, SwatchIcon } from "@/components/Icons";
import JobStatusBadge from "@/components/JobStatusBadge";
import { SectionHeading } from "@/components/PageHeading";
import { formatDate, formatDateTime } from "@/lib/format";
import type { JobDetail } from "@/lib/jobs/queries";

// Read-only job information and workflow outline, shared by the employee and
// owner job pages.
export function JobSummary({ detail }: { detail: JobDetail }) {
  const { job, card } = detail;
  return (
    <section className="rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wider text-charcoal-400 uppercase">
            Job #{job.job_number}
          </p>
          <h1 className="mt-1 text-2xl font-semibold break-words text-white">{job.client_name}</h1>
        </div>
        <JobStatusBadge status={job.status} />
      </div>

      <dl className="mt-4 flex flex-col gap-3 text-[15px]">
        <Item icon={<MapPinIcon className="h-5 w-5" />} label="Address" value={job.address} />
        <Item
          icon={<RulerIcon className="h-5 w-5" />}
          label="Square footage"
          value={`${job.square_feet.toLocaleString("en-US")} sq ft`}
        />
        <Item icon={<SwatchIcon className="h-5 w-5" />} label="Flake" value={job.flake_color} />
        <Item
          icon={<CalendarIcon className="h-5 w-5" />}
          label="Scheduled"
          value={formatDate(job.scheduled_date, { withYear: true })}
        />
      </dl>

      <dl className="mt-5 divide-y divide-charcoal-800 rounded-2xl bg-charcoal-800/60 text-[15px]">
        <Flag label="Caulking" value={job.caulking_required ? "Required" : "Not required"} />
        <Flag label="Baseboard" value={job.baseboard_required ? "Required" : "Not required"} />
        <Flag
          label="Allow Employees to Join"
          value={job.allow_employees_to_join ? "On" : "Off"}
        />
        <Flag label="Team" value={card.teamNames.join(", ") || "No one assigned yet"} />
        <Flag label="Last activity" value={formatDateTime(job.last_activity_at)} />
      </dl>

      {job.general_notes && (
        <div className="mt-5">
          <p className="text-xs font-semibold tracking-[0.15em] text-charcoal-400 uppercase">Notes</p>
          <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-line text-white">
            {job.general_notes}
          </p>
        </div>
      )}
    </section>
  );
}

export function JobWorkflowOutline({ detail }: { detail: JobDetail }) {
  const { job } = detail;
  return (
    <section aria-labelledby="job-workflow" className="mt-8">
      <SectionHeading id="job-workflow" title="Workflow" />
      <p className="-mt-1 mb-4 text-sm text-charcoal-400">
        Workflow version {job.workflow_version}, copied when this job was created. Later workflow
        changes don’t affect this job.
      </p>
      <ol className="flex flex-col gap-3">
        {detail.stages.map((stage, index) => {
          const steps = stage.steps.filter(
            (step) =>
              step.kind === "standard" ||
              (step.appliesWhen === "caulking_required" && job.caulking_required) ||
              (step.appliesWhen === "baseboard_required" && job.baseboard_required),
          );
          return (
            <li key={stage.id} className="rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5">
              <p className="text-lg font-semibold text-white">
                {index + 1}. {stage.name}
              </p>
              {stage.kind === "owner_milestone" ? (
                <p className="mt-1 flex items-center gap-2 text-[15px] text-gold-300">
                  <KeyIcon className="h-5 w-5" /> Owner only · {stage.ownerActionLabel}
                </p>
              ) : steps.length === 0 ? (
                <p className="mt-1 text-[15px] text-charcoal-400">
                  No completion items apply to this job.
                </p>
              ) : (
                <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[15px] text-charcoal-300">
                  {steps.map((step) => (
                    <li key={step.id}>{step.title}</li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Item({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-gold-400">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs font-medium tracking-wider text-charcoal-400 uppercase">{label}</dt>
        <dd className="font-semibold break-words text-white">{value}</dd>
      </div>
    </div>
  );
}

function Flag({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
      <dt className="text-charcoal-400">{label}</dt>
      <dd className="text-right font-semibold text-white">{value}</dd>
    </div>
  );
}
