import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon, CameraIcon, CheckIcon, ChecklistIcon, KeyIcon } from "@/components/Icons";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { loadActiveWorkflow } from "@/lib/workflow/active-workflow";
import type { WorkflowBlock, WorkflowStage, WorkflowStep } from "@/lib/workflow/approved-workflow";

export const metadata: Metadata = {
  title: "Workflow · Armour Ops",
};

// Read-only view of the active workflow exactly as stored in the database,
// for the owner to compare with docs/PRODUCT_SPEC.md.
export default async function WorkflowPreviewPage() {
  await requireOwner();
  const result = await loadActiveWorkflow();

  if (result.status !== "ok") {
    return (
      <>
        <PageHeading eyebrow="Owner" title="Workflow" />
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-900/30 p-4"
        >
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
          <p className="text-[15px] leading-relaxed text-charcoal-300">
            {result.status === "missing"
              ? "No active workflow is loaded yet. Run the Phase 2 database updates in the Supabase SQL Editor (see docs/SUPABASE_SETUP.md, step 9)."
              : "The workflow couldn’t be loaded. Refresh to try again."}
          </p>
        </div>
      </>
    );
  }

  const { workflow } = result;
  const stepCount = workflow.stages.reduce((n, s) => n + s.steps.length, 0);

  return (
    <>
      <PageHeading
        eyebrow="Owner · Read only"
        title="Workflow"
        description={`${workflow.name}, version ${workflow.version}. ${workflow.stages.length} stages, ${stepCount} steps. Every job will follow this version until a new one is published.`}
      />

      <Link
        href="/owner/workflow/pictures"
        className="mb-8 flex min-h-16 items-center justify-center rounded-2xl border border-sky-400/40 bg-charcoal-900 text-lg font-semibold text-sky-100"
      >
        Reference Pictures for Standard Steps
      </Link>

      <div className="flex flex-col gap-8">
        {workflow.stages.map((stage, index) => (
          <StageSection key={stage.key} stage={stage} number={index + 1} />
        ))}
      </div>

      <p className="mt-8 text-center text-xs break-all text-charcoal-400">
        Content fingerprint {workflow.contentSha256.slice(0, 12)}
      </p>
    </>
  );
}

function StageSection({ stage, number }: { stage: WorkflowStage; number: number }) {
  return (
    <section aria-labelledby={`stage-${stage.key}`}>
      <SectionHeading
        id={`stage-${stage.key}`}
        title={`${number}. ${stage.name}`}
        count={stage.steps.length || undefined}
      />

      {stage.kind === "owner_milestone" && (
        <div className="rounded-3xl border border-gold-500/40 bg-charcoal-900 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold tracking-wider text-gold-300 uppercase">
            <KeyIcon className="h-5 w-5" /> Owner only
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-charcoal-300">{stage.description}</p>
          <RuleList heading={stage.rulesHeading} rules={stage.rules} ordered />
          <p className="mt-4 rounded-2xl bg-charcoal-800 px-4 py-3 text-[15px] font-semibold text-white">
            Owner action: {stage.ownerAction?.label}
          </p>
        </div>
      )}

      {stage.kind === "completion_work" && (
        <div className="mb-4 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5">
          <p className="text-[15px] leading-relaxed text-charcoal-300">{stage.description}</p>
          <RuleList heading={stage.rulesHeading} rules={stage.rules} ordered={false} />
        </div>
      )}

      {stage.steps.length > 0 && (
        <ol className="flex flex-col gap-3">
          {stage.steps.map((step, index) => (
            <li key={step.key}>
              <StepCard step={step} number={index + 1} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RuleList({
  heading,
  rules,
  ordered,
}: {
  heading: string | null;
  rules: readonly string[];
  ordered: boolean;
}) {
  const List = ordered ? "ol" : "ul";
  return (
    <>
      {heading && <p className="mt-3 text-[15px] font-semibold text-white">{heading}</p>}
      <List
        className={`mt-2 flex flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-charcoal-300 ${
          ordered ? "list-decimal" : "list-disc"
        }`}
      >
        {rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </List>
    </>
  );
}

function StepCard({ step, number }: { step: WorkflowStep; number: number }) {
  if (step.kind === "completion_item") {
    return (
      <div className="flex min-h-16 items-center gap-3 rounded-2xl border border-charcoal-800 bg-charcoal-900 px-5 py-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-charcoal-600" />
        <div>
          <p className="text-lg font-semibold text-white">{step.title}</p>
          <p className="text-sm text-charcoal-400">
            Shown only when {step.appliesWhen === "caulking_required" ? "caulking" : "baseboard"} is
            selected on the job.
          </p>
        </div>
      </div>
    );
  }

  return (
    <details className="group rounded-3xl border border-charcoal-800 bg-charcoal-900 open:border-gold-500/30">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-charcoal-800 text-sm font-bold text-gold-300">
          {number}
        </span>
        <span className="min-w-0 flex-1 text-lg font-semibold text-white">{step.title}</span>
        <ProofBadge step={step} />
      </summary>

      <div className="flex flex-col gap-5 border-t border-charcoal-800 px-5 pt-4 pb-5">
        {step.note && (
          <p className="rounded-2xl border border-gold-500/30 bg-gold-900/30 p-4 text-[15px] leading-relaxed text-charcoal-300">
            {step.note}
          </p>
        )}
        <Field label="Goal">{step.goal}</Field>

        {step.blocks.map((block) => (
          <BlockView key={block.heading} block={block} />
        ))}

        {step.inputs.length > 0 && (
          <div>
            <FieldLabel>Required structured inputs</FieldLabel>
            <ul className="mt-2 flex flex-col gap-2">
              {step.inputs.map((input) => (
                <li key={input.key} className="rounded-2xl bg-charcoal-800 px-4 py-3 text-[15px] text-white">
                  <span className="font-semibold">{input.label}</span>
                  <span className="text-charcoal-300">
                    {" "}
                    ·{" "}
                    {input.type === "single_select"
                      ? `choose one: ${input.choices?.join(", ")}`
                      : input.type === "number"
                        ? input.wholeNumber
                          ? "whole number"
                          : "number"
                        : "written text"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <FieldLabel>Required proof</FieldLabel>
          {step.proofRequirements.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2">
              {step.proofRequirements.map((proof) => (
                <li
                  key={proof.label}
                  className="flex items-start gap-2 text-[15px] leading-relaxed text-charcoal-300"
                >
                  <CameraIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold-400" />
                  {proof.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[15px] text-charcoal-300">{step.proofText}</p>
          )}
        </div>

        <Field label="Confirmation">“{step.confirmationText}”</Field>
      </div>
    </details>
  );
}

function ProofBadge({ step }: { step: WorkflowStep }) {
  const label = step.proofType === "none" ? "No proof" : step.proofType === "video" ? "Video" : "Pictures";
  return (
    <span className="shrink-0 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-charcoal-300 ring-1 ring-white/15">
      {label}
    </span>
  );
}

function BlockView({ block }: { block: WorkflowBlock }) {
  if (block.kind === "checklist") {
    return (
      <div>
        <FieldLabel>
          {block.heading} <span className="text-gold-300">· every item required</span>
        </FieldLabel>
        <ul className="mt-2 flex flex-col gap-2">
          {block.items.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[15px] leading-relaxed text-white">
              <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold-400" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const ordered = block.kind === "ordered_list";
  const List = ordered ? "ol" : "ul";
  return (
    <div>
      <FieldLabel>
        {block.heading}
        {block.kind === "reference_list" && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-charcoal-300 normal-case ring-1 ring-white/15">
            <ChecklistIcon className="h-3.5 w-3.5" /> Reference only
          </span>
        )}
      </FieldLabel>
      <List
        className={`mt-2 flex flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-charcoal-300 ${
          ordered ? "list-decimal" : "list-disc"
        }`}
      >
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </List>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-[0.15em] text-charcoal-400 uppercase">{children}</p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <p className="mt-1 text-[15px] leading-relaxed text-white">{children}</p>
    </div>
  );
}
