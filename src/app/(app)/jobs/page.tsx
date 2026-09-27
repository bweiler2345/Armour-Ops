import type { Metadata } from "next";
import EmptyState from "@/components/EmptyState";
import { AlertIcon } from "@/components/Icons";
import JobCard from "@/components/JobCard";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import TeamActionButton from "@/components/TeamActionButton";
import TemporaryPasswordReminder from "@/components/TemporaryPasswordReminder";
import { requireUser } from "@/lib/dal";
import { listJobCards } from "@/lib/jobs/queries";
import { groupJobsForEmployee } from "@/lib/jobs/sections";

export const metadata: Metadata = {
  title: "Jobs · Armour Ops",
};

export default async function JobsPage() {
  const user = await requireUser();
  const firstName = user.fullName.trim().split(/\s+/)[0];
  const result = await listJobCards();

  return (
    <>
      <PageHeading
        eyebrow={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        title="Jobs"
      />
      {user.mustChangePassword && <TemporaryPasswordReminder />}

      {result.status === "error" ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4"
        >
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          <p className="text-[15px] leading-relaxed text-red-100">
            Jobs couldn’t be loaded. Check your connection and refresh.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groupJobsForEmployee(result.jobs, user.id).map((section) => (
            <section key={section.key} aria-labelledby={`section-${section.key}`}>
              <SectionHeading
                id={`section-${section.key}`}
                title={section.title}
                count={section.jobs.length}
              />
              {section.jobs.length === 0 ? (
                <EmptyState text={section.emptyText} />
              ) : (
                <div className="flex flex-col gap-4">
                  {section.jobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      href={`/jobs/${job.id}`}
                      highlight={section.key === "mine"}
                      footer={
                        section.key === "available" && user.role === "employee" ? (
                          <TeamActionButton jobId={job.id} kind="claim" />
                        ) : undefined
                      }
                    />
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
