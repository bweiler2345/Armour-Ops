import type { Metadata } from "next";
import JobCard from "@/components/JobCard";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import TemporaryPasswordReminder from "@/components/TemporaryPasswordReminder";
import { requireUser } from "@/lib/dal";
import { activeJob, availableJobs } from "@/lib/mock-data";

export const metadata: Metadata = {
  title: "Jobs · Armour Ops",
};

export default async function JobsPage() {
  const user = await requireUser();
  const firstName = user.fullName.trim().split(/\s+/)[0];

  return (
    <>
      <PageHeading
        eyebrow={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        title="Jobs"
      />
      {user.mustChangePassword && <TemporaryPasswordReminder />}

      <section aria-labelledby="active-job" className="mb-8">
        <SectionHeading id="active-job" title="My Active Job" />
        <JobCard job={activeJob} variant="active" />
      </section>

      <section aria-labelledby="available-jobs">
        <SectionHeading
          id="available-jobs"
          title="Available Jobs"
          count={availableJobs.length}
        />
        <div className="flex flex-col gap-4">
          {availableJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      </section>
    </>
  );
}
