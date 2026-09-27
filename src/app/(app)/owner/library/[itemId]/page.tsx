import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmAction from "@/components/ConfirmAction";
import { AlertIcon } from "@/components/Icons";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import ReferencePictures from "@/components/ReferencePictures";
import StepPreview from "@/components/StepPreview";
import { archiveLibraryItem } from "@/lib/actions/library";
import { requireOwner } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { getLibraryItem } from "@/lib/library/queries";

export const metadata: Metadata = {
  title: "Library Step · Armour Ops",
};

export default async function LibraryStepPage({ params }: PageProps<"/owner/library/[itemId]">) {
  await requireOwner();
  const { itemId } = await params;
  const item = await getLibraryItem(itemId);
  if (item === null) notFound();
  if (item === "error") {
    return (
      <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
        <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
        This library step couldn’t be loaded. Refresh to try again.
      </p>
    );
  }

  return (
    <>
      <Link href="/owner/library" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← Custom Step Library
      </Link>
      <PageHeading
        eyebrow={`Library step · Version ${item.version}${item.archived ? " · Archived" : ""}`}
        title={item.definition.title}
        description={`Imported into ${item.importedCount} job step${item.importedCount === 1 ? "" : "s"}. Those copies never change.`}
      />
      {item.archived && item.archivedAt && (
        <p className="mb-4 rounded-2xl border border-charcoal-600 bg-charcoal-900 p-4 text-[15px] text-charcoal-300">
          Archived {formatDateTime(item.archivedAt)}. It can’t be imported into new jobs. Jobs that imported it keep their copy.
        </p>
      )}

      <p className="mb-2 text-xs font-semibold tracking-[0.15em] text-charcoal-400 uppercase">Preview</p>
      <StepPreview definition={item.definition} />

      <ReferencePictures
        pictures={item.references}
        manage={item.archived ? undefined : { target: "library_item", targetId: item.id, path: `/owner/library/${item.id}` }}
      />

      {!item.archived && (
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href={`/owner/library/${item.id}/edit`}
            className="gold-gradient flex min-h-16 items-center justify-center rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30"
          >
            Edit (Saves Version {item.version + 1})
          </Link>
          <ConfirmAction
            action={archiveLibraryItem.bind(null, item.id)}
            label="Archive"
            title="Archive this library step?"
            body="It won’t be offered for new imports and can’t be edited. Every version and every job that imported it stay as they are."
            confirmLabel="Archive"
            busyLabel="Archiving…"
            tone="danger"
          />
        </div>
      )}

      <section aria-labelledby="versions" className="mt-8">
        <SectionHeading id="versions" title="Versions" count={item.versions.length} />
        <ul className="flex flex-col gap-2">
          {item.versions.map((v) => (
            <li key={v.number} className="rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3 text-[15px] text-white">
              Version {v.number}: {v.title}
              <span className="block text-sm text-charcoal-400">{formatDateTime(v.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
