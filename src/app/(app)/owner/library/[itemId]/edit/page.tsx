import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeading from "@/components/PageHeading";
import { updateLibraryItem } from "@/lib/actions/library";
import { requireOwner } from "@/lib/dal";
import { getLibraryItem } from "@/lib/library/queries";
import LibraryItemForm from "../../LibraryItemForm";

export const metadata: Metadata = {
  title: "Edit Library Step · Armour Ops",
};

export default async function EditLibraryStepPage({ params }: PageProps<"/owner/library/[itemId]/edit">) {
  await requireOwner();
  const { itemId } = await params;
  const item = await getLibraryItem(itemId);
  if (item === null || item === "error" || item.archived) notFound();
  return (
    <>
      <Link href={`/owner/library/${itemId}`} className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← {item.definition.title}
      </Link>
      <PageHeading
        eyebrow={`Owner · Version ${item.version}`}
        title="Edit Library Step"
        description="Saving creates the next version for future imports. Jobs that already imported this step keep their copy."
      />
      <LibraryItemForm action={updateLibraryItem.bind(null, itemId)} initial={item.definition} submitLabel="Save New Version" />
    </>
  );
}
