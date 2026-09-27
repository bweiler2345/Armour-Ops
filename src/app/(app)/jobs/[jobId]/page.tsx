import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertIcon } from "@/components/Icons";
import { JobSummary, JobWorkflowOutline } from "@/components/JobDetails";
import { requireUser } from "@/lib/dal";
import { getJobDetail } from "@/lib/jobs/queries";

export const metadata: Metadata = {
  title: "Job · Armour Ops",
};

// Read-only job view for everyone. Claiming and joining arrive in Phase 4;
// step work arrives in Phase 5.
export default async function JobPage({ params }: PageProps<"/jobs/[jobId]">) {
  await requireUser();
  const { jobId } = await params;
  const result = await getJobDetail(jobId);
  if (result.status === "missing") notFound();

  return (
    <>
      <Link
        href="/jobs"
        className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300"
      >
        ← All jobs
      </Link>

      {result.status === "error" ? (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          This job couldn’t be loaded. Refresh to try again.
        </p>
      ) : (
        <>
          <JobSummary detail={result.detail} />
          {result.detail.job.status === "scheduled" && (
            <p className="mt-4 rounded-2xl border border-sky-400/30 bg-sky-400/10 p-4 text-[15px] leading-relaxed text-sky-100">
              Not available yet. The owner will make this job available when it’s ready to claim.
            </p>
          )}
          <JobWorkflowOutline detail={result.detail} />
        </>
      )}
    </>
  );
}
