import type { Metadata } from "next";
import JobCard from "@/components/JobCard";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import { activeJob, availableJobs, employee } from "@/lib/mock-data";

export const metadata: Metadata = {
  title: "Jobs · Armour Ops",
};

export default function JobsPage() {
  const firstName = employee.name.split(" ")[0];

  return (
    <>
      <PageHeading eyebrow={`Welcome back, ${firstName}`} title="Jobs" />

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
