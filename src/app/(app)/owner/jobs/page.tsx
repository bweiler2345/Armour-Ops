import type { Metadata } from "next";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";
import { AlertIcon, PlusIcon } from "@/components/Icons";
import JobCard from "@/components/JobCard";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { listJobCards } from "@/lib/jobs/queries";
import { isActiveStatus } from "@/lib/jobs/status";

export const metadata: Metadata = {
  title: "Jobs · Owner · Armour Ops",
};

export default async function OwnerJobsPage() {
  await requireOwner();
  const result = await listJobCards();

  const groups =
    result.status === "ok"
      ? [
          {
            key: "scheduled",
            title: "Scheduled",
            empty: "No Scheduled jobs. Create a job to get started.",
            jobs: result.jobs.filter((j) => j.status === "scheduled"),
          },
          {
            key: "available",
            title: "Available to Claim",
            empty: "No jobs are available to claim. Make a Scheduled job available when it’s ready.",
            jobs: result.jobs.filter((j) => j.status === "available_to_claim"),
          },
          {
            key: "active",
            title: "In Progress",
            empty: "No jobs are in progress.",
            jobs: result.jobs.filter((j) => isActiveStatus(j.status)),
          },
          {
            key: "complete",
            title: "Complete",
            empty: "No completed jobs yet.",
            jobs: result.jobs.filter((j) => j.status === "complete"),
          },
        ]
      : [];

  return (
    <>
      <PageHeading eyebrow="Owner" title="Jobs" />

      <Link
        href="/owner/jobs/new"
        className="gold-gradient mb-8 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98]"
      >
        <PlusIcon className="h-6 w-6" />
        New Job
      </Link>

      {result.status === "error" ? (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          Jobs couldn’t be loaded. Refresh to try again.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`owner-${group.key}`}>
              <SectionHeading id={`owner-${group.key}`} title={group.title} count={group.jobs.length} />
              {group.jobs.length === 0 ? (
                <EmptyState text={group.empty} />
              ) : (
                <div className="flex flex-col gap-4">
                  {group.jobs.map((job) => (
                    <JobCard key={job.id} job={job} href={`/owner/jobs/${job.id}`} actionLabel="Manage Job" />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
