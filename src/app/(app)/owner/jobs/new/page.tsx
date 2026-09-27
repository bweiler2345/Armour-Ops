import type { Metadata } from "next";
import Link from "next/link";
import PageHeading from "@/components/PageHeading";
import { createJob } from "@/lib/actions/jobs";
import { requireOwner } from "@/lib/dal";
import { JOB_DEFAULTS } from "@/lib/jobs/validation";
import JobForm from "../JobForm";

export const metadata: Metadata = {
  title: "New Job · Armour Ops",
};

export default async function NewJobPage() {
  await requireOwner();

  return (
    <>
      <Link
        href="/owner/jobs"
        className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300"
      >
        ← Jobs
      </Link>
      <PageHeading
        eyebrow="Owner"
        title="New Job"
        description="New jobs start as Scheduled. Employees can see them but can’t claim them until you select Make Available."
      />
      <JobForm
        action={createJob}
        submitLabel="Create Job"
        pendingLabel="Creating…"
        initialValues={{
          clientName: "",
          address: "",
          squareFeet: "",
          flakeColor: "",
          scheduledDate: "",
          notes: "",
          ...JOB_DEFAULTS,
        }}
      />
    </>
  );
}
