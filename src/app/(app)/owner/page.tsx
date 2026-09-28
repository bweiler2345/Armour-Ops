import type { Metadata } from "next";
import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { AlertIcon, ChecklistIcon, ChevronRightIcon, JobsIcon, UsersIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
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
  const [result, params] = await Promise.all([loadOwnerDashboard(), searchParams]);

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
