import type { Metadata } from "next";
import Link from "next/link";
import PageHeading from "@/components/PageHeading";
import { createLibraryItem } from "@/lib/actions/library";
import { requireOwner } from "@/lib/dal";
import { EMPTY_DEFINITION } from "@/lib/steps/definition";
import LibraryItemForm from "../LibraryItemForm";

export const metadata: Metadata = {
  title: "New Library Step · Armour Ops",
};

export default async function NewLibraryStepPage() {
  await requireOwner();
  return (
    <>
      <Link href="/owner/library" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← Custom Step Library
      </Link>
      <PageHeading eyebrow="Owner" title="New Library Step" description="You can add reference pictures after saving." />
      <LibraryItemForm action={createLibraryItem} initial={EMPTY_DEFINITION} submitLabel="Save to Library" />
    </>
  );
}
