import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon, ChevronRightIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { listSetupHistory } from "@/lib/inventory/queries";
import { weekRange } from "@/lib/inventory/status";

export const metadata: Metadata = {
  title: "Pre-Week Setup History · Armour Ops",
};

// Every trailer's weekly setup, newest week first. Choose a trailer to see
// only its weeks.
export default async function SetupHistoryPage({ searchParams }: PageProps<"/owner/pre-week-setup/history">) {
  await requireOwner();
  const [rows, params] = await Promise.all([listSetupHistory(), searchParams]);
  const trailer = typeof params.trailer === "string" ? params.trailer : "";
  const trailers = [...new Map((rows ?? []).map((r) => [r.trailer_id, r.trailer_name])).entries()];
  const shown = (rows ?? []).filter((r) => !trailer || r.trailer_id === trailer);

  return (
    <>
      <Link href="/owner/pre-week-setup" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
        ← Pre-Week Setup
      </Link>
      <PageHeading eyebrow="Owner" title="Pre-Week Setup History" description="Every week’s check for every trailer. Past weeks never change." />
      {rows === null ? (
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          History couldn’t be loaded. Refresh to try again.
        </p>
      ) : (
        <>
          <nav aria-label="Trailer" className="mb-4 flex flex-wrap gap-2">
            {[["", "All trailers"] as const, ...trailers].map(([id, name]) => (
              <Link
                key={id || "all"}
                href={id ? `/owner/pre-week-setup/history?trailer=${id}` : "/owner/pre-week-setup/history"}
                aria-current={trailer === id ? "page" : undefined}
                className={`flex min-h-12 items-center rounded-2xl border px-4 text-[15px] font-semibold ${
                  trailer === id ? "border-gold-400 bg-gold-900/50 text-white" : "border-charcoal-700 text-charcoal-300"
                }`}
              >
                {name}
              </Link>
            ))}
          </nav>
          {shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-charcoal-700 p-5 text-center text-[15px] text-charcoal-400">No weeks yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link href={`/owner/pre-week-setup/setups/${r.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16px] font-semibold text-white">
                        {r.trailer_name} · {weekRange(r.week_start)}
                        {r.trailer_archived_at ? " · Archived trailer" : ""}
                      </span>
                      <span className="block text-sm text-charcoal-300">
                        {r.state === "submitted"
                          ? `Submitted by ${r.submitted_by_name || "a team member"}${r.submitted_at ? ` · ${formatDateTime(r.submitted_at)}` : ""}`
                          : `Not submitted · ${r.assessed_count} of ${r.item_count} checked`}
                      </span>
                      <span className="block text-sm">
                        <span className="text-emerald-200">{r.ready_count} Ready</span> ·{" "}
                        <span className="text-gold-200">{r.need_more_count} Need More</span> ·{" "}
                        <span className="text-red-200">{r.missing_count} Missing</span>
                      </span>
                    </span>
                    <ChevronRightIcon className="h-5 w-5 shrink-0 text-gold-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
