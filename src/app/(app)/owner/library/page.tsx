import type { Metadata } from "next";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";
import { AlertIcon, ChevronRightIcon, PlusIcon } from "@/components/Icons";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { listLibraryItems, type LibraryListItem } from "@/lib/library/queries";

export const metadata: Metadata = {
  title: "Custom Step Library · Armour Ops",
};

// Owner-only reusable custom steps (for example Sand Stairs or Grind Down
// Lip). Importing copies a step into a job; later edits never change jobs
// that already have it.
export default async function LibraryPage() {
  await requireOwner();
  const items = await listLibraryItems();
  const active = (items ?? []).filter((i) => !i.archived);
  const archived = (items ?? []).filter((i) => i.archived);

  return (
    <>
      <Link href="/owner" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← Owner Dashboard
      </Link>
      <PageHeading
        eyebrow="Owner"
        title="Custom Step Library"
        description="Reusable steps you can import into jobs. Editing a step saves a new version for future imports; jobs keep the version they imported."
      />
      <Link
        href="/owner/library/new"
        className="gold-gradient mb-8 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 active:scale-[0.98]"
      >
        <PlusIcon className="h-6 w-6" /> New Library Step
      </Link>
      {items === null ? (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          The library couldn’t be loaded. Refresh to try again.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <section aria-labelledby="library-active">
            <SectionHeading id="library-active" title="Library steps" count={active.length} />
            {active.length === 0 ? <EmptyState text="No library steps yet." /> : <ItemList items={active} />}
          </section>
          {archived.length > 0 && (
            <section aria-labelledby="library-archived">
              <SectionHeading id="library-archived" title="Archived" count={archived.length} />
              <ItemList items={archived} />
            </section>
          )}
        </div>
      )}
    </>
  );
}

function ItemList({ items }: { items: LibraryListItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/owner/library/${item.id}`}
            className="flex min-h-16 items-center gap-3 rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3 active:scale-[0.99]"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-semibold text-white">{item.title}</span>
              <span className="block text-sm text-charcoal-400">
                Version {item.version} · {formatDateTime(item.updatedAt)}
                {item.archived ? " · Archived" : ""}
              </span>
            </span>
            <ChevronRightIcon className="h-6 w-6 shrink-0 text-gold-300" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
