import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeading from "@/components/PageHeading";
import ReferencePictures from "@/components/ReferencePictures";
import { requireOwner } from "@/lib/dal";
import { isUuid } from "@/lib/jobs/errors";
import { listWorkflowStepReferences } from "@/lib/library/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Step Reference Pictures · Armour Ops",
};

export default async function WorkflowStepPicturesPage({ params }: PageProps<"/owner/workflow/pictures/[stepId]">) {
  await requireOwner();
  const { stepId } = await params;
  if (!isUuid(stepId)) notFound();
  const supabase = await createClient();
  const step = supabase
    ? await supabase.from("workflow_step_templates").select("id, title, kind").eq("id", stepId).maybeSingle()
    : null;
  if (!step?.data || step.data.kind !== "standard") notFound();
  const pictures = await listWorkflowStepReferences(stepId);

  return (
    <>
      <Link href="/owner/workflow/pictures" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← Reference Pictures
      </Link>
      <PageHeading
        eyebrow="Standard step"
        title={step.data.title}
        description="Changes apply to jobs created from now on. Existing jobs keep the pictures they already have."
      />
      <ReferencePictures
        pictures={pictures ?? []}
        manage={{ target: "workflow_step", targetId: stepId, path: `/owner/workflow/pictures/${stepId}` }}
      />
    </>
  );
}
