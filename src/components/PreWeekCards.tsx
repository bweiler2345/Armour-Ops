import Link from "next/link";
import { AlertIcon, CheckIcon, ChevronRightIcon, TrailerIcon } from "@/components/Icons";
import { formatDateTime } from "@/lib/format";
import type { ShortageLine, TrailerCard } from "@/lib/inventory/queries";
import { shortageText, STATUS_LABELS } from "@/lib/inventory/status";

// Pre-Week Setup summaries shared by the employee screen, the owner's page,
// and the Owner Dashboard.

export function setupStateLabel(card: TrailerCard) {
  if (!card.setup) return "Not started";
  return card.setup.state === "submitted" ? "Submitted" : "Draft";
}

export function TrailerSummaryCard({ card, href }: { card: TrailerCard; href: string }) {
  const s = card.setup;
  const submitted = s?.state === "submitted";
  const percent = s && s.item_count > 0 ? Math.round((s.assessed_count / s.item_count) * 100) : 0;
  return (
    <li>
      <Link
        href={href}
        className={`flex flex-col gap-3 rounded-3xl border-2 p-5 shadow-lg shadow-black/30 active:scale-[0.99] ${
          submitted ? "border-emerald-400/40 bg-charcoal-900" : "border-gold-500/60 bg-gold-900/20"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="flex items-center gap-3">
            <TrailerIcon className="h-8 w-8 shrink-0 text-gold-300" />
            <span className="text-2xl font-bold text-white">{card.name}</span>
          </span>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${
              submitted ? "bg-emerald-400/10 text-emerald-200 ring-emerald-400/30" : "bg-gold-400/15 text-gold-200 ring-gold-400/40"
            }`}
          >
            {setupStateLabel(card)}
          </span>
        </div>
        {s ? (
          <>
            <div className="flex items-center gap-3">
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-charcoal-700" aria-hidden>
                <div className="gold-gradient h-full rounded-full" style={{ width: `${percent}%` }} />
              </div>
              <span className="text-sm text-charcoal-300 tabular-nums">
                {s.assessed_count} of {s.item_count} checked
              </span>
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
              <span className="text-emerald-200">{s.ready_count} Ready</span>
              <span className="font-semibold text-gold-200">{s.need_more_count} Need More</span>
              <span className="font-semibold text-red-200">{s.missing_count} Missing</span>
            </p>
            {submitted && s.submitted_at && (
              <p className="text-sm text-charcoal-400">
                Submitted by {s.submitted_by_name || "a team member"} · {formatDateTime(s.submitted_at)}
              </p>
            )}
          </>
        ) : (
          <p className="text-[15px] text-charcoal-300">Not started this week.</p>
        )}
        <span className="flex items-center gap-1 text-[16px] font-semibold text-gold-200">
          {submitted ? "View" : s ? "Continue" : "Start"} <ChevronRightIcon className="h-5 w-5" />
        </span>
      </Link>
    </li>
  );
}

// Every Missing and Need More item this week: each trailer's shortage, and a
// combined total when more than one trailer needs it.
export function ShortageList({ lines, setupHref }: { lines: ShortageLine[]; setupHref: (setupId: string) => string }) {
  if (lines.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] text-emerald-100">
        <CheckIcon className="h-5 w-5 shrink-0" /> No shortages recorded this week.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => (
        <li key={`${line.label}|${line.unitLabel}`} className="rounded-2xl border border-charcoal-800 bg-charcoal-900 p-4">
          <p className="flex items-start justify-between gap-3 text-[16px] font-semibold text-white">
            <span>{line.label}</span>
            {line.total !== null && line.perTrailer.length > 1 && (
              <span className="shrink-0 text-gold-200">Total: {shortageText(line.total, line.unitLabel)}</span>
            )}
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {line.perTrailer.map((t) => (
              <li key={t.setupId}>
                <Link href={setupHref(t.setupId)} className="flex items-start gap-2 text-[15px]">
                  <AlertIcon className={`mt-0.5 h-4 w-4 shrink-0 ${t.status === "missing" ? "text-red-300" : "text-gold-300"}`} />
                  <span className="text-charcoal-200">
                    {t.trailerName}:{" "}
                    <span className={`font-semibold ${t.status === "missing" ? "text-red-200" : "text-gold-200"}`}>
                      {STATUS_LABELS[t.status]}
                      {line.tracking === "count" && t.shortage ? ` · ${shortageText(t.shortage, line.unitLabel)}` : ""}
                    </span>
                    {t.note && <span className="text-charcoal-400"> · {t.note}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
