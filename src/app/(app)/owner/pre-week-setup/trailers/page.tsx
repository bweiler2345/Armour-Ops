import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { listTrailers } from "@/lib/inventory/queries";
import TrailerManager from "./TrailerManager";

export const metadata: Metadata = {
  title: "Trailers · Armour Ops",
};

export default async function TrailersPage() {
  await requireOwner();
  const trailers = await listTrailers();
  return (
    <>
      <Link href="/owner/pre-week-setup" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← Pre-Week Setup
      </Link>
      <PageHeading eyebrow="Owner" title="Trailers" description="Every trailer uses the same inventory list. A new name shows everywhere, including past weeks; the counts and targets recorded each week never change." />
      {trailers === null ? (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          Trailers couldn’t be loaded. Refresh to try again.
        </p>
      ) : (
        <TrailerManager trailers={trailers.map((t) => ({ id: t.id, name: t.name, archived: t.archived_at !== null }))} />
      )}
    </>
  );
}
