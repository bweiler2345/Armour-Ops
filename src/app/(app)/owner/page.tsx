import type { Metadata } from "next";
import { ChecklistIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";

export const metadata: Metadata = {
  title: "Owner Dashboard · Armour Ops",
};

// Placeholder. The dashboard, Team screen, and job management arrive in
// later phases (see docs/IMPLEMENTATION_PLAN.md).
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

      <div className="flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-900/30 p-4">
        <ChecklistIcon className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
        <p className="text-[15px] leading-relaxed text-charcoal-300">
          <span className="font-semibold text-white">Coming soon.</span> Job
          monitoring, installation milestones, the Team screen, and Weekly
          Setup review will appear here in later phases.
        </p>
      </div>
    </>
  );
}
