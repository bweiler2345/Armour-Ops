import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { TrailerSummaryCard } from "@/components/PreWeekCards";
import { requireUser } from "@/lib/dal";
import { listTrailerCards } from "@/lib/inventory/queries";
import { weekRange, weekStart } from "@/lib/inventory/status";

export const metadata: Metadata = {
  title: "Pre-Week Setup · Armour Ops",
};

// Each trailer's inventory check for this week (Monday to Sunday, Central).
export default async function PreWeekSetupPage() {
  const user = await requireUser();
  const cards = await listTrailerCards();

  return (
    <>
      <PageHeading
        eyebrow={`Week of ${weekRange(weekStart())}`}
        title="Pre-Week Setup"
        description="Check each trailer’s inventory before the week’s work."
      />
      {user.role === "owner" && (
        <Link href="/owner/pre-week-setup" className="mb-6 inline-flex min-h-12 items-center font-semibold text-gold-300">
          Manage trailers, targets, and history →
        </Link>
      )}
      {cards === null ? (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          Trailers couldn’t be loaded. Refresh to try again.
        </p>
      ) : cards.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-charcoal-700 p-5 text-center text-[15px] text-charcoal-400">No trailers yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {cards.map((card) => (
            <TrailerSummaryCard key={card.id} card={card} href={`/pre-week-setup/${card.id}`} />
          ))}
        </ul>
      )}
    </>
  );
}
