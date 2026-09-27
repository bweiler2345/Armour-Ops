import type { Metadata } from "next";
import Link from "next/link";
import { ChecklistIcon, ChevronRightIcon, UsersIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";

export const metadata: Metadata = {
  title: "Owner Dashboard · Armour Ops",
};

// Placeholder dashboard. Job management arrives in later phases (see
// docs/IMPLEMENTATION_PLAN.md).
export default async function OwnerDashboardPage() {
  const user = await requireOwner();
  const firstName = user.fullName.trim().split(/\s+/)[0];

  return (
    <>
      <PageHeading
        eyebrow={firstName ? `Signed in as ${firstName}` : "Signed in"}
        title="Owner Dashboard"
        description="Only owner accounts can open this page."
      />

      <Link
        href="/owner/team"
        className="mb-6 flex min-h-20 items-center gap-4 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5 transition hover:border-gold-500/40 active:scale-[0.99]"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-charcoal-800 text-gold-400">
          <UsersIcon className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-white">Team</p>
          <p className="text-[15px] text-charcoal-300">
            Create accounts, reset passwords, turn access on or off
          </p>
        </div>
        <ChevronRightIcon className="h-6 w-6 shrink-0 text-gold-300" />
      </Link>

      <div className="flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-900/30 p-4">
        <ChecklistIcon className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
        <p className="text-[15px] leading-relaxed text-charcoal-300">
          <span className="font-semibold text-white">Coming soon.</span> Job
          monitoring, installation milestones, and Weekly Setup review will
          appear here in later phases.
        </p>
      </div>
    </>
  );
}
