import type { Metadata } from "next";
import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { AlertIcon, ChecklistIcon, ChevronRightIcon, JobsIcon, UsersIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { ShortageList, TrailerSummaryCard } from "@/components/PreWeekCards";
import { requireOwner } from "@/lib/dal";
import { currentShortages, listTrailerCards } from "@/lib/inventory/queries";
import { weekRange, weekStart } from "@/lib/inventory/status";
import { filtersFromParams } from "@/lib/owner/dashboard";
import { loadOwnerDashboard } from "@/lib/owner/queries";
import OwnerDashboard from "./OwnerDashboard";

export const metadata: Metadata = {
  title: "Owner Dashboard · Armour Ops",
};

// The owner's operating view: what needs the owner, work in progress,
// upcoming and available jobs, recent completions, and recent activity. It
// refreshes itself while open and when the app returns to the foreground
// (no live connection). Employees text the owner when a job is ready for an
// installation.
export default async function OwnerDashboardPage({ searchParams }: PageProps<"/owner">) {
  const user = await requireOwner();
  const firstName = user.fullName.trim().split(/\s+/)[0];
  const [result, params, trailers, shortages] = await Promise.all([
    loadOwnerDashboard(),
    searchParams,
    listTrailerCards(),
    currentShortages(),
  ]);
  const notSubmitted = (trailers ?? []).filter((t) => t.setup?.state !== "submitted").length;

  return (
    <>
      <PageHeading
        eyebrow={firstName ? `Signed in as ${firstName}` : "Signed in"}
        title="Owner Dashboard"
        description="Every job at a glance. Jobs waiting for you come first."
      />

      {result.status === "error" ? (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          The dashboard couldn’t be loaded. It will try again shortly, or refresh now.
        </p>
      ) : (
        <OwnerDashboard
          jobs={result.jobs}
          activity={result.activity}
          loadedAt={result.loadedAt}
          initialFilters={filtersFromParams(params)}
        />
      )}

      <section aria-labelledby="pre-week" className="dashboard-wide mt-10">
        <h2 id="pre-week" className="mb-3 flex items-center justify-between text-lg font-semibold text-white">
          <span>
            Pre-Week Setup <span className="text-sm font-normal text-charcoal-400">· week of {weekRange(weekStart())}</span>
          </span>
          {notSubmitted > 0 && (
            <span className="gold-gradient rounded-full px-3 py-0.5 text-sm font-bold text-charcoal-950">{notSubmitted} not submitted</span>
          )}
        </h2>
        {trailers === null || shortages === null ? (
          <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
            Pre-Week Setup couldn’t be loaded. It will try again shortly.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ul className="flex flex-col gap-3">
              {trailers.map((card) => (
                <TrailerSummaryCard
                  key={card.id}
                  card={card}
                  href={card.setup ? `/owner/pre-week-setup/setups/${card.setup.id}` : `/pre-week-setup/${card.id}`}
                />
              ))}
            </ul>
            <div>
              <p className="mb-2 text-sm font-semibold tracking-wide text-charcoal-300 uppercase">Shortages this week</p>
              <ShortageList lines={shortages} setupHref={(id) => `/owner/pre-week-setup/setups/${id}`} />
              <Link href="/owner/pre-week-setup" className="mt-2 inline-flex min-h-11 items-center font-semibold text-gold-300">
                Pre-Week Setup details →
              </Link>
            </div>
          </div>
        )}
      </section>

      <nav aria-label="Owner tools" className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { href: "/owner/jobs", title: "Jobs", text: "Create, edit, and manage every job", Icon: JobsIcon },
          { href: "/owner/library", title: "Custom Step Library", text: "Reusable steps like Sand Stairs", Icon: ChecklistIcon },
          { href: "/owner/team", title: "Team", text: "Accounts, passwords, and access", Icon: UsersIcon },
          { href: "/owner/workflow", title: "Workflow", text: "The approved workflow and reference pictures", Icon: ChecklistIcon },
        ].map(({ href, title, text, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-20 items-center gap-4 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-4 transition hover:border-gold-500/40 active:scale-[0.99]"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-charcoal-800 text-gold-400">
              <Icon className="h-7 w-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold text-white">{title}</span>
              <span className="block text-[15px] text-charcoal-300">{text}</span>
            </span>
            <ChevronRightIcon className="h-6 w-6 shrink-0 text-gold-300" />
          </Link>
        ))}
      </nav>

      <AutoRefresh everyMs={20_000} />
    </>
  );
}
