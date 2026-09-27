import type { Metadata } from "next";
import {
  ChecklistIcon,
  ChevronRightIcon,
  TrailerIcon,
} from "@/components/Icons";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";
import { trailers } from "@/lib/mock-data";

export const metadata: Metadata = {
  title: "Weekly Setup · Armour Ops",
};

export default async function WeeklySetupPage() {
  await requireUser();

  return (
    <>
      <PageHeading
        eyebrow="Before the week starts"
        title="Weekly Setup"
        description="This section will contain the weekly trailer inventory checklist, so each crew can confirm their trailer is ready before heading out."
      />

      <div className="mb-8 flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-900/30 p-4">
        <ChecklistIcon className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
        <p className="text-[15px] leading-relaxed text-charcoal-300">
          <span className="font-semibold text-white">Coming soon.</span> The
          inventory checklist is not built yet. The trailers below are sample
          placeholders.
        </p>
      </div>

      <section aria-labelledby="trailers">
        <SectionHeading id="trailers" title="Trailers" count={trailers.length} />
        <div className="flex flex-col gap-4">
          {trailers.map((trailer) => (
            <article
              key={trailer.id}
              className="rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-charcoal-800 text-gold-400">
                  <TrailerIcon className="h-8 w-8" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xl font-semibold text-white">
                    {trailer.name}
                  </h3>
                  <p className="truncate text-sm text-charcoal-400">
                    {trailer.unit}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-charcoal-300 ring-1 ring-white/15">
                  Not started
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-charcoal-800 px-3 py-3">
                  <dt className="text-[11px] font-medium tracking-wider text-charcoal-400 uppercase">
                    Assigned to
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-white">
                    {trailer.assignedCrew}
                  </dd>
                </div>
                <div className="rounded-2xl bg-charcoal-800 px-3 py-3">
                  <dt className="text-[11px] font-medium tracking-wider text-charcoal-400 uppercase">
                    Last checked
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-white">
                    {formatDate(trailer.lastChecked)}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                disabled
                className="mt-5 flex min-h-16 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-charcoal-700 bg-charcoal-800 text-lg font-semibold text-charcoal-400"
              >
                Checklist coming soon
                <ChevronRightIcon className="h-6 w-6" />
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
