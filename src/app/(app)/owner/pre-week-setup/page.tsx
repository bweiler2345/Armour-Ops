import type { Metadata } from "next";
import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { AlertIcon, ChevronRightIcon } from "@/components/Icons";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import { ShortageList, TrailerSummaryCard } from "@/components/PreWeekCards";
import { requireOwner } from "@/lib/dal";
import { currentShortages, listTrailerCards } from "@/lib/inventory/queries";
import { weekRange, weekStart } from "@/lib/inventory/status";

export const metadata: Metadata = {
  title: "Pre-Week Setup · Owner · Armour Ops",
};

// This week's results for every active trailer, the combined shortage
// review, and links to trailers, the inventory list, and history.
export default async function OwnerPreWeekSetupPage() {
  await requireOwner();
  const [cards, shortages] = await Promise.all([listTrailerCards(), currentShortages()]);

  return (
    <>
      <Link href="/owner" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← Owner Dashboard
      </Link>
      <PageHeading eyebrow={`Week of ${weekRange(weekStart())}`} title="Pre-Week Setup" description="This week’s trailer checks and what needs restocking." />

      {cards === null || shortages === null ? (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          Pre-Week Setup couldn’t be loaded. Refresh to try again.
        </p>
      ) : (
        <>
          <section aria-labelledby="this-week">
            <SectionHeading id="this-week" title="This week" count={cards.length} />
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {cards.map((card) => (
                <TrailerSummaryCard
                  key={card.id}
                  card={card}
                  href={card.setup ? `/owner/pre-week-setup/setups/${card.setup.id}` : `/pre-week-setup/${card.id}`}
                />
              ))}
            </ul>
          </section>

          <section aria-labelledby="shortages" className="mt-8">
            <SectionHeading id="shortages" title="Shortage review" count={shortages.length} />
            <ShortageList lines={shortages} setupHref={(id) => `/owner/pre-week-setup/setups/${id}`} />
          </section>
        </>
      )}

      <nav aria-label="Pre-Week Setup management" className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { href: "/owner/pre-week-setup/trailers", title: "Trailers", text: "Rename, add, or archive" },
          { href: "/owner/pre-week-setup/items", title: "Inventory list", text: "Items and targets for future weeks" },
          { href: "/owner/pre-week-setup/history", title: "History", text: "Every week’s submissions" },
        ].map((link) => (
          <Link key={link.href} href={link.href} className="flex min-h-20 items-center gap-3 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-4">
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold text-white">{link.title}</span>
              <span className="block text-sm text-charcoal-300">{link.text}</span>
            </span>
            <ChevronRightIcon className="h-6 w-6 shrink-0 text-gold-300" />
          </Link>
        ))}
      </nav>
      <AutoRefresh everyMs={30_000} />
    </>
  );
}
