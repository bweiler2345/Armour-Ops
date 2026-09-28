import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmAction from "@/components/ConfirmAction";
import { AlertIcon } from "@/components/Icons";
import PageHeading, { SectionHeading } from "@/components/PageHeading";
import { reopenSetup } from "@/lib/actions/pre-week-setup";
import { requireOwner } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { listSubmissions, loadSetup } from "@/lib/inventory/queries";
import { shortageText, STATUS_LABELS, weekRange, type InventoryStatus } from "@/lib/inventory/status";

export const metadata: Metadata = {
  title: "Trailer Setup · Armour Ops",
};

const statusClass: Record<InventoryStatus, string> = {
  ready: "text-emerald-200",
  need_more: "font-semibold text-gold-200",
  missing: "font-semibold text-red-200",
};

// One trailer's week: every item as recorded, who changed it and when, every
// submission (kept whole), reopenings, and Reopen with a reason.
export default async function SetupDetailPage({ params }: PageProps<"/owner/pre-week-setup/setups/[setupId]">) {
  await requireOwner();
  const { setupId } = await params;
  const [detail, submissions] = await Promise.all([loadSetup(setupId), listSubmissions(setupId)]);
  if (detail === null) notFound();
  const back = (
    <Link href="/owner/pre-week-setup" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
      ← Pre-Week Setup
    </Link>
  );
  if (detail === "error" || submissions === null) {
    return (
      <>
        {back}
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          This setup couldn’t be loaded. Refresh to try again.
        </p>
      </>
    );
  }
  const { overview, items } = detail;
  const categories = [...new Set(items.map((i) => i.category))];

  return (
    <>
      {back}
      <PageHeading
        eyebrow={`Week of ${weekRange(overview.week_start)}`}
        title={overview.trailer_name}
        description={
          overview.state === "submitted"
            ? `Submitted by ${overview.submitted_by_name || "a team member"}${overview.submitted_at ? ` · ${formatDateTime(overview.submitted_at)}` : ""}`
            : `Not submitted · ${overview.assessed_count} of ${overview.item_count} checked`
        }
      />
      <p className="mb-4 flex flex-wrap gap-x-4 text-[16px] font-semibold">
        <span className="text-emerald-200">{overview.ready_count} Ready</span>
        <span className="text-gold-200">{overview.need_more_count} Need More</span>
        <span className="text-red-200">{overview.missing_count} Missing</span>
      </p>

      {overview.state === "submitted" && !overview.trailer_archived_at && (
        <div className="mb-6">
          <ConfirmAction
            action={reopenSetup.bind(null, overview.id)}
            label="Reopen"
            title="Reopen this setup?"
            body="The team can change counts and submit again. This submission is kept in history exactly as it is."
            reasonLabel="Reason (required)"
            confirmLabel="Reopen"
            busyLabel="Reopening…"
          />
        </div>
      )}

      {categories.map((category) => (
        <section key={category} className="mb-6">
          <h2 className="mb-2 text-lg font-semibold text-gold-300">{category}</h2>
          <ul className="flex flex-col gap-2">
            {items
              .filter((i) => i.category === category)
              .map((i) => (
                <li key={i.id} className="rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3">
                  <p className="flex items-start justify-between gap-3 text-[16px] text-white">
                    <span className="font-semibold">{i.label}</span>
                    <span className={i.status ? statusClass[i.status] : "text-charcoal-400"}>{i.status ? STATUS_LABELS[i.status] : "Not checked"}</span>
                  </p>
                  <p className="text-sm text-charcoal-300">
                    {i.tracking === "count"
                      ? `${i.usable_quantity ?? "–"} of ${i.target_quantity}${i.unit_label ? ` ${i.unit_label}` : ""}${i.shortage ? ` · ${shortageText(i.shortage, i.unit_label)}` : ""}`
                      : "Ready / Need More / Missing"}
                    {i.note ? ` · ${i.note}` : ""}
                  </p>
                  {i.updated_at && (
                    <p className="text-xs text-charcoal-400">
                      {i.updated_by_name || "Someone"} · {formatDateTime(i.updated_at)}
                    </p>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}

      {overview.restock_notes && (
        <section className="mb-6">
          <SectionHeading title="Restock notes" />
          <p className="text-[15px] whitespace-pre-line text-white">{overview.restock_notes}</p>
        </section>
      )}

      <section aria-labelledby="submissions" className="mb-6">
        <SectionHeading id="submissions" title="Submissions" count={submissions.length} />
        {submissions.length === 0 ? (
          <p className="text-[15px] text-charcoal-400">Not submitted yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {submissions.map((s) => (
              <li key={s.id} className="rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3 text-[15px] text-white">
                {s.submitted_by_name || "A team member"} · {formatDateTime(s.submitted_at)}
                <span className="block text-sm text-charcoal-300">
                  {s.ready_count} Ready · {s.need_more_count} Need More · {s.missing_count} Missing
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.reopenings.length > 0 && (
        <section aria-labelledby="reopenings">
          <SectionHeading id="reopenings" title="Reopened" count={detail.reopenings.length} />
          <ul className="flex flex-col gap-2">
            {detail.reopenings.map((r) => (
              <li key={r.id} className="rounded-2xl border border-gold-500/40 bg-gold-900/20 px-4 py-3 text-[15px] text-white">
                {r.reopenedByName || "The owner"} · {formatDateTime(r.reopenedAt)}
                <span className="block text-sm text-gold-100">“{r.reason}”</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
