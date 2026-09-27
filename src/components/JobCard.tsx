import Link from "next/link";
import {
  CalendarIcon,
  ChevronRightIcon,
  MapPinIcon,
  RulerIcon,
  SwatchIcon,
  UsersIcon,
} from "@/components/Icons";
import JobStatusBadge from "@/components/JobStatusBadge";
import { formatDate, formatDateTime } from "@/lib/format";
import type { JobCardData } from "@/lib/jobs/queries";

// Shows every job-card field from docs/PRODUCT_SPEC.md: client, address,
// square footage, flake color, scheduled date, team, status, current step,
// overall progress, and last activity time.
export default function JobCard({
  job,
  href,
  actionLabel = "View Job",
  highlight = false,
  footer,
}: {
  job: JobCardData;
  href: string;
  actionLabel?: string;
  highlight?: boolean;
  // Replaces the main button (for example, Claim Job), with a smaller link
  // to the job below it.
  footer?: React.ReactNode;
}) {
  const notStarted = job.progress.completed === 0;

  return (
    <article
      className={`overflow-hidden rounded-3xl border bg-charcoal-900 ${
        highlight ? "border-gold-500/40 shadow-xl shadow-black/40" : "border-charcoal-800"
      }`}
    >
      {highlight && <div className="gold-gradient h-1 w-full" />}

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wider text-charcoal-400 uppercase">
              Job #{job.jobNumber}
            </p>
            <h3 className="mt-1 text-xl font-semibold break-words text-white">{job.clientName}</h3>
          </div>
          <JobStatusBadge status={job.status} />
        </div>

        <p className="mt-3 flex items-start gap-2 text-[15px] text-charcoal-300">
          <MapPinIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold-400" />
          <span className="break-words">{job.address}</span>
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-2">
          <Detail
            icon={<RulerIcon className="h-5 w-5" />}
            label="Area"
            value={`${job.squareFeet.toLocaleString("en-US")} sq ft`}
          />
          <Detail icon={<SwatchIcon className="h-5 w-5" />} label="Flake" value={job.flakeColor} />
          <Detail
            icon={<CalendarIcon className="h-5 w-5" />}
            label="Scheduled"
            value={formatDate(job.scheduledDate)}
          />
        </dl>

        <dl className="mt-4 flex flex-col gap-2 text-[15px]">
          <Row label="Team">
            {job.teamNames.length > 0 ? (
              job.teamNames.join(", ")
            ) : (
              <span className="inline-flex items-center gap-1.5 text-charcoal-400">
                <UsersIcon className="h-4 w-4" /> No one assigned yet
              </span>
            )}
          </Row>
          <Row label="Current step">
            {job.currentStepTitle ? (
              <>
                {job.currentStepTitle}
                {notStarted && <span className="text-charcoal-400"> · not started</span>}
              </>
            ) : (
              <span className="text-charcoal-400">—</span>
            )}
          </Row>
          <Row label="Last activity">{formatDateTime(job.lastActivityAt)}</Row>
        </dl>

        <div className="mt-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-charcoal-300">Progress</span>
            <span className="font-semibold text-white tabular-nums">
              {job.progress.percent}%
              <span className="font-normal text-charcoal-400">
                {" "}
                · {job.progress.completed} of {job.progress.total}
              </span>
            </span>
          </div>
          <div
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-charcoal-700"
            role="progressbar"
            aria-valuenow={job.progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${job.clientName} job progress`}
          >
            <div
              className="gold-gradient h-full rounded-full"
              style={{ width: `${job.progress.percent}%` }}
            />
          </div>
        </div>

        {footer ? (
          <div className="mt-5 flex flex-col gap-2">
            {footer}
            <Link
              href={href}
              className="flex min-h-12 items-center justify-center text-[15px] font-semibold text-gold-300"
            >
              View details
            </Link>
          </div>
        ) : (
          <Link
            href={href}
            className={`mt-5 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl text-lg font-semibold transition active:scale-[0.98] ${
              highlight
                ? "gold-gradient text-charcoal-950 shadow-lg shadow-black/30"
                : "border border-gold-500/50 bg-charcoal-800 text-gold-300 hover:bg-charcoal-700"
            }`}
          >
            {actionLabel}
            <ChevronRightIcon className="h-6 w-6" />
          </Link>
        )}
      </div>
    </article>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-charcoal-800 px-3 py-3">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-charcoal-400 uppercase">
        <span className="text-gold-400">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5 text-sm leading-snug font-semibold break-words text-white">{value}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-charcoal-400">{label}</dt>
      <dd className="text-right font-medium text-white">{children}</dd>
    </div>
  );
}
