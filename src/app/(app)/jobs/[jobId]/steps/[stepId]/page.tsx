import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { AlertIcon, CameraIcon, CheckIcon, ChecklistIcon, LockIcon, VideoIcon } from "@/components/Icons";
import StepStateBadge from "@/components/StepStateBadge";
import { requireUser } from "@/lib/dal";
import { formatDateTime, formatTime } from "@/lib/format";
import { formatBytes, formatDuration } from "@/lib/media/files";
import { getStepDetail, type StepBlock } from "@/lib/steps/queries";
import ClearHoldButton from "./ClearHoldButton";
import StepWorkspace from "./StepWorkspace";

export const metadata: Metadata = {
  title: "Step · Armour Ops",
};

// One step of a job, from the job's own workflow snapshot. Active team
// members work open steps here; everyone else sees it read only.
export default async function StepPage({ params }: PageProps<"/jobs/[jobId]/steps/[stepId]">) {
  const user = await requireUser();
  const { jobId, stepId } = await params;
  const result = await getStepDetail(jobId, stepId);
  if (result.status === "missing") notFound();

  if (result.status === "error") {
    return (
      <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
        <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
        This step couldn’t be loaded. Refresh to try again.
      </p>
    );
  }

  const { detail } = result;
  const { step, status } = detail;
  const open = status.state === "available" || status.state === "in_progress";
  const onTeam = detail.teamIds.includes(user.id);
  const canWork = user.role === "employee" && onTeam && open && step.kind === "standard";
  const checks = detail.blocks
    .filter((b) => b.kind === "checklist")
    .flatMap((b) => b.items);
  const heldByOther = status.hold_held_by && status.hold_held_by !== user.id;
  const jobHref = user.role === "owner" ? `/owner/jobs/${jobId}` : `/jobs/${jobId}`;

  return (
    <>
      <Link href={jobHref} className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← Job #{detail.job.jobNumber} · {detail.job.clientName}
      </Link>

      <header className="rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.15em] text-gold-400 uppercase">
            {detail.stage.name}
            {step.kind === "standard" && step.stepsInStage > 0 && ` · Step ${step.numberInStage} of ${step.stepsInStage}`}
          </p>
          <StepStateBadge state={status.state} />
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-white">{step.title}</h1>
        {step.kind === "standard" && step.stepsInStage > 0 && (
          <div className="mt-4 flex gap-1.5" aria-hidden>
            {Array.from({ length: step.stepsInStage }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${
                  i + 1 < step.numberInStage || (i + 1 === step.numberInStage && status.state === "completed")
                    ? "gold-gradient"
                    : i + 1 === step.numberInStage
                      ? "bg-gold-500/50"
                      : "bg-charcoal-700"
                }`}
              />
            ))}
          </div>
        )}
      </header>

      {/* Who can do what here. */}
      <div className="mt-4 flex flex-col gap-3">
        {status.state === "completed" && (
          <Banner tone="done">
            Completed by {status.completed_by_name || "a team member"}
            {status.completed_at ? ` · ${formatDateTime(status.completed_at)}` : ""}
          </Banner>
        )}
        {status.state === "locked" && step.kind === "standard" && (
          <Banner tone="locked">Locked. Finish the earlier steps first.</Banner>
        )}
        {step.kind === "completion_item" && (
          <Banner tone="locked">Completion Work opens after the top coat is installed.</Banner>
        )}
        {open && !onTeam && user.role === "employee" && (
          <Banner tone="info">You’re not on this job’s team, so you can view this step but not change it.</Banner>
        )}
        {open && user.role === "owner" && (
          <Banner tone="info">
            Team members complete steps. You can view progress here
            {status.hold_held_by ? " and clear an edit hold someone left open." : "."}
          </Banner>
        )}
        {!canWork && heldByOther && status.hold_expires_at && (
          <Banner tone="locked">
            {status.hold_held_by_name || "A teammate"} is editing this step until about{" "}
            {formatTime(status.hold_expires_at)}.
          </Banner>
        )}
        {user.role === "owner" && status.hold_held_by && <ClearHoldButton jobId={jobId} stepId={stepId} />}
      </div>

      {step.note && (
        <p className="mt-6 rounded-2xl border-l-4 border-gold-400 bg-gold-900/30 p-4 text-[15px] leading-relaxed text-charcoal-300">
          {step.note}
        </p>
      )}

      {step.goal && (
        <section className="mt-6">
          <SectionLabel>Goal</SectionLabel>
          <p className="mt-1 text-[17px] leading-relaxed text-white">{step.goal}</p>
        </section>
      )}

      {detail.blocks
        .filter((b) => b.kind !== "checklist")
        .map((block) => (
          <BlockSection key={block.id} block={block} />
        ))}

      {canWork ? (
        <StepWorkspace
          jobId={jobId}
          stepId={stepId}
          userId={user.id}
          checks={checks}
          inputs={detail.inputs}
          proofs={detail.proofs}
          initialMedia={detail.media}
          confirmationText={step.confirmationText ?? ""}
          initialChecked={detail.checked}
          initialAnswers={detail.answers}
          initialNotes={detail.notes}
          holderName={heldByOther ? status.hold_held_by_name : null}
          holderExpiresAt={heldByOther ? status.hold_expires_at : null}
          nextStepHref={detail.nextStepId ? `/jobs/${jobId}/steps/${detail.nextStepId}` : null}
        />
      ) : (
        step.kind === "standard" && <ReadOnlyWork detail={detail} checks={checks} canViewMedia={user.role === "owner" || onTeam} />
      )}

      {/* Read-only viewers see teammates' saves without refreshing. */}
      {!canWork && status.state !== "completed" && <AutoRefresh everyMs={8_000} />}

      <nav className="mt-8 grid grid-cols-2 gap-3" aria-label="Steps">
        {detail.previousStepId ? (
          <Link
            href={`/jobs/${jobId}/steps/${detail.previousStepId}`}
            className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-700 bg-charcoal-900 text-base font-semibold text-white"
          >
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        {detail.nextStepId && (
          <Link
            href={`/jobs/${jobId}/steps/${detail.nextStepId}`}
            className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-700 bg-charcoal-900 text-base font-semibold text-white"
          >
            Next →
          </Link>
        )}
      </nav>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold tracking-[0.15em] text-charcoal-400 uppercase">{children}</p>;
}

function Banner({ tone, children }: { tone: "done" | "locked" | "info"; children: React.ReactNode }) {
  const styles = {
    done: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
    locked: "border-charcoal-600 bg-charcoal-900 text-charcoal-300",
    info: "border-sky-400/30 bg-sky-400/10 text-sky-100",
  }[tone];
  const Icon = tone === "done" ? CheckIcon : tone === "locked" ? LockIcon : AlertIcon;
  return (
    <p className={`flex items-start gap-3 rounded-2xl border p-4 text-[15px] leading-relaxed font-medium ${styles}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function BlockSection({ block }: { block: StepBlock }) {
  if (block.kind === "reference_list") {
    return (
      <section className="mt-6 rounded-3xl border border-charcoal-800 bg-charcoal-900/60 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">{block.heading}</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold text-charcoal-300 ring-1 ring-white/15">
            <ChecklistIcon className="h-3.5 w-3.5" /> Reference
          </span>
        </div>
        <p className="mt-1 text-sm text-charcoal-400">For reference. No need to check each item.</p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {block.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-[15px] leading-snug text-charcoal-300">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" aria-hidden />
              {item.text}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-lg font-semibold text-white">{block.heading}</h2>
      <ol className="flex flex-col gap-2">
        {block.items.map((item, i) => (
          <li key={item.id} className="flex items-start gap-3 rounded-2xl bg-charcoal-900 p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-charcoal-800 text-sm font-bold text-gold-300">
              {i + 1}
            </span>
            <span className="text-[16px] leading-relaxed text-white">{item.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReadOnlyWork({
  detail,
  checks,
  canViewMedia,
}: {
  detail: Extract<Awaited<ReturnType<typeof getStepDetail>>, { status: "ok" }>["detail"];
  checks: { id: string; text: string; required: boolean }[];
  canViewMedia: boolean;
}) {
  const checked = new Set(detail.checked);
  const { step } = detail;
  return (
    <div className="mt-6 flex flex-col gap-6">
      {checks.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Final check</h2>
          <ul className="flex flex-col gap-2">
            {checks.map((item) => (
              <li key={item.id} className="flex items-start gap-3 rounded-2xl border border-charcoal-800 bg-charcoal-900 p-4">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${
                    checked.has(item.id) ? "gold-gradient border-transparent text-charcoal-950" : "border-charcoal-600"
                  }`}
                >
                  {checked.has(item.id) && <CheckIcon className="h-5 w-5" />}
                </span>
                <span className="text-[15px] leading-snug text-white">
                  {item.text}
                  {!item.required && <span className="ml-2 text-sm text-charcoal-400">(optional)</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.inputs.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Required entries</h2>
          <dl className="flex flex-col gap-2">
            {detail.inputs.map((input) => (
              <div key={input.id} className="flex items-center justify-between gap-4 rounded-2xl bg-charcoal-900 px-4 py-3">
                <dt className="text-[15px] text-charcoal-300">{input.label}</dt>
                <dd className="text-right text-[15px] font-semibold text-white">
                  {detail.answers[input.id] || <span className="text-charcoal-400">Not entered</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {step.proofType !== "none" && (
        <section className="rounded-3xl border border-gold-500/40 bg-charcoal-900 p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <CameraIcon className="h-6 w-6 text-gold-300" />
            Required {step.proofType === "video" ? "video" : "pictures"}
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {detail.proofs.map((p) => {
              const files = detail.media.filter((m) => m.requirementId === p.id && m.status === "uploaded");
              return (
                <li key={p.id} className="rounded-2xl bg-charcoal-800 px-4 py-3">
                  <p className="text-[15px] text-white">{p.label}</p>
                  {files.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {files.map((m) => (
                        <li key={m.id}>
                          {/* Opens through the access check and a short-lived private link. */}
                          <a
                            href={`/media/${m.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 rounded-xl bg-charcoal-900 p-1.5 pr-3 text-sm text-charcoal-300"
                          >
                            {m.mediaType === "picture" ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/media/${m.id}`} alt="" loading="lazy" className="h-16 w-16 rounded-lg object-cover" />
                            ) : (
                              <>
                                <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-charcoal-700 text-gold-300">
                                  <VideoIcon className="h-7 w-7" />
                                </span>
                                {[m.durationSeconds !== null ? formatDuration(m.durationSeconds) : null, formatBytes(m.sizeBytes ?? m.declaredSizeBytes)]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </>
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-charcoal-400">
                      {canViewMedia ? "Nothing uploaded yet." : "Only the job’s team and the owner can see proof files."}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {step.proofType === "none" && step.proofText && (
        <p className="text-[15px] text-charcoal-400">Required proof: {step.proofText}</p>
      )}

      {detail.notes && (
        <section>
          <SectionLabel>Notes</SectionLabel>
          <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-line text-white">{detail.notes}</p>
        </section>
      )}

      {step.confirmationText && (
        <section className="rounded-2xl border border-charcoal-800 bg-charcoal-900 p-4">
          <SectionLabel>Confirmation</SectionLabel>
          <p className="mt-1 text-[15px] leading-relaxed font-medium text-white">“{step.confirmationText}”</p>
        </section>
      )}
    </div>
  );
}
