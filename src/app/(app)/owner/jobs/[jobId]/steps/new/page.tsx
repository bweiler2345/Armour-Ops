import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { addCustomStep } from "@/lib/actions/custom-steps";
import { requireOwner } from "@/lib/dal";
import { getJobDetail } from "@/lib/jobs/queries";
import { isActiveStatus } from "@/lib/jobs/status";
import { customStepPositions, listLibraryItems } from "@/lib/library/queries";
import CustomStepForm from "./CustomStepForm";

export const metadata: Metadata = {
  title: "Add Custom Step · Armour Ops",
};

export default async function AddCustomStepPage({ params }: PageProps<"/owner/jobs/[jobId]/steps/new">) {
  await requireOwner();
  const { jobId } = await params;
  const [result, positions, library] = await Promise.all([
    getJobDetail(jobId),
    customStepPositions(jobId),
    listLibraryItems(),
  ]);
  if (result.status === "missing") notFound();
  const back = (
    <Link href={`/owner/jobs/${jobId}`} className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
      ← Job
    </Link>
  );
  if (result.status === "error" || positions === null || library === null) {
    return (
      <>
        {back}
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          This page couldn’t be loaded. Refresh to try again.
        </p>
      </>
    );
  }

  const { detail } = result;
  const stages = positions.map((p) => ({
    ...p,
    steps: (detail.stages.find((s) => s.id === p.stageId)?.steps ?? []).map((s, i) => ({ position: i + 1, title: s.title })),
  }));

  return (
    <>
      {back}
      <PageHeading
        eyebrow={`Job #${detail.job.job_number} · ${detail.job.client_name}`}
        title="Add Custom Step"
        description="For extra work such as Sand Stairs or Grind Down Lip. The step becomes part of this job only."
      />
      {stages.length === 0 ? (
        <p className="rounded-2xl border border-charcoal-700 bg-charcoal-900 p-4 text-[15px] text-charcoal-300">
          No stage can take a new step right now. Steps can go only into preparation stages the job hasn’t finished, and
          never into installations, Completion Work, or a complete job.
        </p>
      ) : (
        <CustomStepForm
          action={addCustomStep.bind(null, jobId)}
          stages={stages}
          library={library.filter((i) => !i.archived).map((i) => ({ id: i.id, title: i.title, version: i.version }))}
          inProgress={isActiveStatus(detail.job.status)}
        />
      )}
    </>
  );
}
