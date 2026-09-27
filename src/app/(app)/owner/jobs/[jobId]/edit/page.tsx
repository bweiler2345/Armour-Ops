import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeading from "@/components/PageHeading";
import { updateJob } from "@/lib/actions/jobs";
import { requireOwner } from "@/lib/dal";
import { getJobDetail } from "@/lib/jobs/queries";
import JobForm from "../../JobForm";

export const metadata: Metadata = {
  title: "Edit Job · Armour Ops",
};

export default async function EditJobPage({ params }: PageProps<"/owner/jobs/[jobId]/edit">) {
  await requireOwner();
  const { jobId } = await params;
  const result = await getJobDetail(jobId);
  if (result.status === "missing") notFound();

  const back = (
    <Link
      href={`/owner/jobs/${jobId}`}
      className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300"
    >
      ← Back to job
    </Link>
  );

  if (result.status === "error") {
    return (
      <>
        {back}
        <p role="alert" className="text-[15px] text-red-200">
          This job couldn’t be loaded. Refresh to try again.
        </p>
      </>
    );
  }

  const { job } = result.detail;

  if (job.status !== "scheduled") {
    return (
      <>
        {back}
        <PageHeading title="Edit Job" />
        <p className="rounded-2xl border border-gold-500/30 bg-gold-900/30 p-4 text-[15px] leading-relaxed text-charcoal-300">
          Only Scheduled jobs can be edited. Return this job to Scheduled first.
        </p>
      </>
    );
  }

  return (
    <>
      {back}
      <PageHeading eyebrow={`Job #${job.job_number}`} title="Edit Job" />
      <JobForm
        action={updateJob.bind(null, job.id)}
        submitLabel="Save Changes"
        pendingLabel="Saving…"
        initialValues={{
          clientName: job.client_name,
          address: job.address,
          squareFeet: String(job.square_feet),
          flakeColor: job.flake_color,
          scheduledDate: job.scheduled_date,
          notes: job.general_notes,
          caulkingRequired: job.caulking_required,
          baseboardRequired: job.baseboard_required,
          allowEmployeesToJoin: job.allow_employees_to_join,
        }}
      />
    </>
  );
}
