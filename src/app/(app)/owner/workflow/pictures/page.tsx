import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon, ChevronRightIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Reference Pictures · Armour Ops",
};

// Standard steps of the active workflow, with how many reference pictures
// each has. Jobs created from now on get a copy of each step's pictures;
// existing jobs keep what they had.
export default async function WorkflowPicturesPage() {
  await requireOwner();
  const supabase = await createClient();
  const [template, links] = supabase
    ? await Promise.all([
        supabase.from("workflow_templates").select("id").eq("status", "active").maybeSingle(),
        supabase.from("reference_picture_links").select("workflow_step_id").eq("target", "workflow_step").is("archived_at", null),
      ])
    : [null, null];
  const stages =
    supabase && template?.data
      ? await supabase.from("workflow_stage_templates").select("id, name, position").eq("template_id", template.data.id).eq("kind", "employee_stage").order("position")
      : null;
  const steps =
    supabase && stages?.data
      ? await supabase.from("workflow_step_templates").select("id, stage_id, title, position").in("stage_id", stages.data.map((s) => s.id)).order("position")
      : null;

  const failed = !supabase || !template?.data || links?.error || stages?.error || steps?.error;
  const counts = new Map<string, number>();
  for (const l of links?.data ?? []) counts.set(l.workflow_step_id!, (counts.get(l.workflow_step_id!) ?? 0) + 1);

  return (
    <>
      <Link href="/owner/workflow" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← Workflow
      </Link>
      <PageHeading
        eyebrow="Owner"
        title="Reference Pictures"
        description="Guidance pictures for standard steps (never proof). New jobs get a copy of each step’s current pictures; existing jobs keep theirs."
      />
      {failed ? (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          The workflow couldn’t be loaded. Refresh to try again.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {stages!.data!.map((stage) => (
            <section key={stage.id}>
              <h2 className="mb-2 text-lg font-semibold text-white">{stage.name}</h2>
              <ul className="flex flex-col gap-2">
                {steps!.data!
                  .filter((s) => s.stage_id === stage.id)
                  .map((step) => (
                    <li key={step.id}>
                      <Link
                        href={`/owner/workflow/pictures/${step.id}`}
                        className="flex min-h-16 items-center gap-3 rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3"
                      >
                        <span className="min-w-0 flex-1 text-[16px] font-semibold text-white">{step.title}</span>
                        <span className="text-sm text-charcoal-400">{counts.get(step.id) ?? 0} pictures</span>
                        <ChevronRightIcon className="h-5 w-5 shrink-0 text-gold-300" />
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
