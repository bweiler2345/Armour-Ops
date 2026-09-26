import {
  CalendarIcon,
  ChevronRightIcon,
  MapPinIcon,
  RulerIcon,
  SwatchIcon,
} from "@/components/Icons";
import { formatDate, type Job, type JobStatus } from "@/lib/mock-data";

const statusStyles: Record<JobStatus, string> = {
  "In Progress": "bg-gold-400/15 text-gold-300 ring-gold-400/40",
  Scheduled: "bg-white/5 text-charcoal-300 ring-white/15",
  Open: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
};

type JobCardProps = {
  job: Job;
  variant?: "active" | "available";
};

export default function JobCard({ job, variant = "available" }: JobCardProps) {
  const isActive = variant === "active";

  return (
    <article
      className={`overflow-hidden rounded-3xl border bg-charcoal-900 ${
        isActive
          ? "border-gold-500/40 shadow-xl shadow-black/40"
          : "border-charcoal-800"
      }`}
    >
      {isActive && <div className="gold-gradient h-1 w-full" />}

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wider text-charcoal-400 uppercase">
              {job.id} · {job.projectType}
            </p>
            <h3 className="mt-1 truncate text-xl font-semibold text-white">
              {job.clientName}
            </h3>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusStyles[job.status]}`}
          >
            {job.status}
          </span>
        </div>

        <p className="mt-3 flex items-start gap-2 text-[15px] text-charcoal-300">
          <MapPinIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold-400" />
          <span>
            {job.address}, {job.city}
          </span>
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-2">
          <Detail
            icon={<RulerIcon className="h-5 w-5" />}
            label="Area"
            value={`${job.squareFeet.toLocaleString("en-US")} sq ft`}
          />
          <Detail
            icon={<SwatchIcon className="h-5 w-5" />}
            label="Flake"
            value={job.flakeColor}
            swatch={job.flakeSwatch}
          />
          <Detail
            icon={<CalendarIcon className="h-5 w-5" />}
            label="Scheduled"
            value={formatDate(job.scheduledDate)}
          />
        </dl>

        <div className="mt-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-charcoal-300">Progress</span>
            <span className="font-semibold text-white tabular-nums">
              {job.progress}%
            </span>
          </div>
          <div
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-charcoal-700"
            role="progressbar"
            aria-valuenow={job.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${job.clientName} job progress`}
          >
            <div
              className="gold-gradient h-full rounded-full"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>

        <button
          type="button"
          className={`mt-5 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl text-lg font-semibold transition active:scale-[0.98] ${
            isActive
              ? "gold-gradient text-charcoal-950 shadow-lg shadow-black/30"
              : "border border-gold-500/50 bg-charcoal-800 text-gold-300 hover:bg-charcoal-700"
          }`}
        >
          {isActive ? "Open Job" : "Claim Job"}
          <ChevronRightIcon className="h-6 w-6" />
        </button>
      </div>
    </article>
  );
}

function Detail({
  icon,
  label,
  value,
  swatch,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  swatch?: string[];
}) {
  return (
    <div className="rounded-2xl bg-charcoal-800 px-3 py-3">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-charcoal-400 uppercase">
        <span className="text-gold-400">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5 text-sm leading-snug font-semibold text-white">
        {swatch && (
          <span className="mb-1 flex gap-1" aria-hidden>
            {swatch.map((color) => (
              <span
                key={color}
                className="h-3 w-3 rounded-full ring-1 ring-white/20"
                style={{ backgroundColor: color }}
              />
            ))}
          </span>
        )}
        {value}
      </dd>
    </div>
  );
}
