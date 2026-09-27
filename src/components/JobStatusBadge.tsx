import { JOB_STATUS_LABELS, isActiveStatus, type JobStatus } from "@/lib/jobs/status";

export default function JobStatusBadge({ status }: { status: JobStatus }) {
  const style =
    status === "complete"
      ? "bg-white/5 text-charcoal-300 ring-white/15"
      : status === "available_to_claim"
        ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"
        : isActiveStatus(status)
          ? "bg-gold-400/15 text-gold-300 ring-gold-400/40"
          : "bg-sky-400/10 text-sky-200 ring-sky-400/30";

  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${style}`}>
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}
