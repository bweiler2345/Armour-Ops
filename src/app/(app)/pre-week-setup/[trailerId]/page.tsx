import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertIcon, CheckIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireUser } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { loadSetup, openCurrentSetup } from "@/lib/inventory/queries";
import { weekRange, weekStart } from "@/lib/inventory/status";
import SetupChecklist from "./SetupChecklist";

export const metadata: Metadata = {
  title: "Pre-Week Setup · Armour Ops",
};

// One trailer's checklist for this week. Opening it the first time this week
// creates the week's snapshot of the inventory list.
export default async function TrailerSetupPage({ params }: PageProps<"/pre-week-setup/[trailerId]">) {
  const user = await requireUser();
  const { trailerId } = await params;
  const setupId = await openCurrentSetup(trailerId);
  if (setupId === null) notFound();
  const detail = setupId === "error" ? "error" : await loadSetup(setupId);
  if (detail === null) notFound();

  const back = (
    <Link href="/pre-week-setup" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
      ← Pre-Week Setup
    </Link>
  );
  if (detail === "error") {
    return (
      <>
        {back}
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          This checklist couldn’t be loaded. Your saved counts are safe; refresh to try again.
        </p>
      </>
    );
  }

  const { overview, items } = detail;
  const submitted = overview.state === "submitted";
  const reopened = detail.reopenings.at(-1);
  const editable =
    user.role === "employee" && !submitted && (overview.week_start === weekStart() || detail.reopenings.length > 0);

  return (
    <>
      {back}
      <PageHeading
        eyebrow={`Week of ${weekRange(overview.week_start)}`}
        title={overview.trailer_name}
        description="Count what’s usable right now. Broken or unusable items don’t count; add a note instead."
      />

      {submitted && (
        <p className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] font-medium text-emerald-100">
          <CheckIcon className="mt-0.5 h-5 w-5 shrink-0" />
          Submitted by {overview.submitted_by_name || "a team member"}
          {overview.submitted_at ? ` · ${formatDateTime(overview.submitted_at)}` : ""}. It’s read only; the owner can reopen it.
        </p>
      )}
      {!submitted && reopened && (
        <p className="mb-4 rounded-2xl border border-gold-500/50 bg-gold-900/40 p-4 text-[15px] text-white">
          Reopened by {reopened.reopenedByName || "the owner"} · {formatDateTime(reopened.reopenedAt)}: “{reopened.reason}”
        </p>
      )}
      {user.role === "owner" && (
        <p className="mb-4 rounded-2xl border border-sky-400/30 bg-sky-400/10 p-4 text-[15px] text-sky-100">
          Employees fill in Pre-Week Setup. You can review it here or on{" "}
          <Link href={`/owner/pre-week-setup/setups/${overview.id}`} className="font-semibold underline">
            the owner’s setup page
          </Link>
          .
        </p>
      )}

      <SetupChecklist
        setupId={overview.id}
        restockNotes={overview.restock_notes}
        editable={editable}
        items={items.map((i) => ({
          id: i.id,
          category: i.category,
          label: i.label,
          tracking: i.tracking,
          target: i.target_quantity,
          unit: i.unit_label,
          quantity: i.usable_quantity,
          status: i.status,
          shortage: i.shortage,
          note: i.note,
        }))}
      />
    </>
  );
}
