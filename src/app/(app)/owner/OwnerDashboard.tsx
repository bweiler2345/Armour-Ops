"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fieldClass } from "@/components/fieldClass";
import { AlertIcon, CameraIcon, ChevronRightIcon, KeyIcon, LockIcon, UsersIcon } from "@/components/Icons";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { describeActivity } from "@/lib/jobs/activity";
import { WORKING_OWNER_LABEL } from "@/lib/jobs/team";
import {

  categoryOf,
  filtersToQuery,
  groupDashboard,
  jobLinks,
  NO_FILTERS,
  ownerAction,
  peopleOn,
  statusLabel,
  type Category,
  type DashboardJob,
  type Filters,
} from "@/lib/owner/dashboard";
import type { RecentActivity } from "@/lib/owner/queries";

// Data older than this is flagged, for example after the phone was offline.
const STALE_MS = 90_000;

// The owner's operating view. Filters live in this component (and the
// address bar), so the page's automatic refresh never resets them.
export default function OwnerDashboard({
  jobs,
  activity,
  loadedAt,
  initialFilters,
}: {
  jobs: DashboardJob[];
  activity: RecentActivity[];
  loadedAt: string;
  initialFilters: Filters;
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [stale, setStale] = useState(false);
  const groups = useMemo(() => groupDashboard(jobs, filters), [jobs, filters]);
  const totals = useMemo(() => groupDashboard(jobs), [jobs]);
  const people = useMemo(() => peopleOn(jobs), [jobs]);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  // Keep the chosen filters in the address, without reloading the page.
  useEffect(() => {
    window.history.replaceState(null, "", `${window.location.pathname}${filtersToQuery(filters)}`);
  }, [filters]);

  useEffect(() => {
    const check = () => setStale(Date.now() - Date.parse(loadedAt) > STALE_MS);
    check();
    const timer = window.setInterval(check, 15_000);
    return () => window.clearInterval(timer);
  }, [loadedAt]);

  const set = (changes: Partial<Filters>) => setFilters((f) => ({ ...f, ...changes }));

  return (
    <div className="flex flex-col gap-6">
      <p role="status" className={`text-sm ${stale ? "font-semibold text-gold-300" : "text-charcoal-400"}`}>
        {stale ? "This may be out of date. Check your connection; it refreshes automatically." : "Updates automatically."} Last
        updated {formatTime(loadedAt)}.
      </p>

      {/* Category chips double as the counts overview. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Chip label="All jobs" count={jobs.length} on={filters.category === "all"} onClick={() => set({ category: "all" })} />
        {totals.map((g) => (
          <Chip
            key={g.key}
            label={g.title}
            count={g.count}
            on={filters.category === g.key}
            gold={g.key === "needs_owner" && g.count > 0}
            onClick={() => set({ category: g.key })}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input
          type="search"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search client, address, or job #"
          aria-label="Search client, address, or job number"
          className={fieldClass(false)}
        />
        <select
          value={filters.employeeId}
          onChange={(e) => set({ employeeId: e.target.value })}
          aria-label="Assigned person"
          className={`${fieldClass(false)} appearance-none`}
        >
          <option value="">Anyone assigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-charcoal-300">
          From
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className={fieldClass(false)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-charcoal-300">
          To
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className={fieldClass(false)} />
        </label>
      </div>
      {filtered && (
        <button
          type="button"
          onClick={() => setFilters(NO_FILTERS)}
          className="min-h-12 self-start rounded-2xl border border-charcoal-600 px-5 text-[15px] font-semibold text-white"
        >
          Clear filters
        </button>
      )}

      {groups
        .filter((g) => filters.category === "all" || g.key === filters.category)
        .map((g) => (
          <section key={g.key} aria-labelledby={`dash-${g.key}`}>
            <h2 id={`dash-${g.key}`} className="mb-3 flex items-center justify-between text-lg font-semibold text-white">
              {g.title}
              <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${g.key === "needs_owner" && g.count > 0 ? "gold-gradient text-charcoal-950" : "bg-charcoal-800 text-charcoal-300"}`}>
                {g.count}
              </span>
            </h2>
            {g.jobs.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-charcoal-700 p-5 text-center text-[15px] text-charcoal-400">
                {filtered ? "No jobs match these filters." : g.empty}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {g.jobs.map((job) => (
                  <DashboardCard key={job.id} job={job} category={g.key} />
                ))}
              </ul>
            )}
            {g.key === "complete" && g.count > g.jobs.length && (
              <Link href="/owner/jobs" className="mt-2 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
                All {g.count} completed jobs on the Jobs screen →
              </Link>
            )}
          </section>
        ))}

      <section aria-labelledby="dash-activity">
        <h2 id="dash-activity" className="mb-3 text-lg font-semibold text-white">
          Recent activity
        </h2>
        {activity.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-charcoal-700 p-5 text-center text-[15px] text-charcoal-400">No activity yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {activity.map((a) => (
              <li key={a.id}>
                <Link href={`/owner/jobs/${a.jobId}`} className="block rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3">
                  <span className="block text-[15px] font-medium text-white">{describeActivity(a).title}</span>
                  <span className="block text-sm text-charcoal-400">
                    #{a.jobNumber} · {a.clientName} · {formatDateTime(a.at)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Chip({
  label,
  count,
  on,
  gold = false,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  gold?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex min-h-16 flex-col items-start justify-center rounded-2xl border px-4 text-left transition active:scale-[0.98] ${
        on ? "border-gold-400 bg-gold-900/50" : gold ? "border-gold-500/60 bg-charcoal-900" : "border-charcoal-800 bg-charcoal-900"
      }`}
    >
      <span className={`text-2xl font-bold tabular-nums ${gold ? "text-gold-300" : "text-white"}`}>{count}</span>
      <span className="text-sm text-charcoal-300">{label}</span>
    </button>
  );
}

function DashboardCard({ job, category }: { job: DashboardJob; category: Category }) {
  const links = jobLinks(job);
  const action = ownerAction(job);
  const waitingForOwner = category === "needs_owner";
  const noTeam = !job.lead && categoryOf(job) === "active";

  return (
    <li
      className={`flex flex-col gap-3 rounded-3xl border p-4 ${
        waitingForOwner || job.reopenedStepTitle ? "border-gold-500/60 bg-gold-900/20" : "border-charcoal-800 bg-charcoal-900"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-white">
            #{job.jobNumber} · {job.clientName}
          </p>
          <p className="truncate text-sm text-charcoal-300">{job.address}</p>
          <p className="text-sm text-charcoal-400">
            {job.squareFeet.toLocaleString("en-US")} sq ft · {job.flakeColor} · {formatDate(job.scheduledDate)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-gold-200 ring-1 ring-gold-400/30">
          {statusLabel(job)}
        </span>
      </div>

      {action && (
        <p className="flex items-center gap-2 text-[15px] font-semibold text-gold-200">
          <KeyIcon className="h-5 w-5 shrink-0" /> Waiting for owner: {action}
        </p>
      )}
      {job.reopenedStepTitle && (
        <p className="flex items-center gap-2 text-[15px] font-semibold text-gold-200">
          <AlertIcon className="h-5 w-5 shrink-0" /> Reopened: “{job.reopenedStepTitle}” needs redoing
        </p>
      )}

      {category !== "scheduled" && category !== "available" && (
        <div>
          <p className="text-[15px] text-white">
            {job.status === "complete"
              ? `Completed ${job.completedAt ? formatDateTime(job.completedAt) : ""}`
              : [job.currentStageName, job.currentStepTitle].filter(Boolean).join(" · ") || "Not started"}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-charcoal-700" aria-hidden>
              <div className="gold-gradient h-full rounded-full" style={{ width: `${job.progress.percent}%` }} />
            </div>
            <span className="text-sm text-charcoal-300 tabular-nums">
              {job.progress.completed} of {job.progress.total}
            </span>
          </div>
        </div>
      )}

      {job.editor && (
        <p className="flex items-center gap-2 text-sm text-sky-100">
          <LockIcon className="h-4 w-4 shrink-0" /> {job.editor.name} is editing “{job.editor.stepTitle}” until about{" "}
          {formatTime(job.editor.expiresAt)}
        </p>
      )}
      {(job.unfinishedUploads > 0 || job.failedUploads > 0) && (
        <p className={`flex items-center gap-2 text-sm ${job.failedUploads > 0 ? "text-red-200" : "text-charcoal-300"}`}>
          <CameraIcon className="h-4 w-4 shrink-0" />
          {[
            job.unfinishedUploads > 0 && `${job.unfinishedUploads} upload${job.unfinishedUploads === 1 ? "" : "s"} in progress`,
            job.failedUploads > 0 && `${job.failedUploads} failed or unfinished upload${job.failedUploads === 1 ? "" : "s"} to fix`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {(job.lead || job.members.length > 0 || job.workingOwners.length > 0 || noTeam) && (
        <p className="flex items-start gap-2 text-sm text-charcoal-300">
          <UsersIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {noTeam && <span className="font-semibold text-gold-200">No team assigned. </span>}
            {[
              job.lead && `${job.lead.name} (Lead)`,
              ...job.members.map((m) => m.name),
              ...job.workingOwners.map((w) => `${w.name} (${WORKING_OWNER_LABEL})`),
            ]
              .filter(Boolean)
              .join(", ")}
          </span>
        </p>
      )}

      {job.lastActivity && (
        <p className="text-sm text-charcoal-400">
          Last:{" "}
          {describeActivity({ type: job.lastActivity.type, actorName: job.lastActivity.actorName, details: { title: job.lastActivity.title }, names: {} }).title}{" "}
          · {formatDateTime(job.lastActivity.at)}
        </p>
      )}

      <div className={`grid gap-2 ${links.step ? "grid-cols-2" : "grid-cols-1"}`}>
        <Link
          href={links.job}
          className="flex min-h-14 items-center justify-center gap-1 rounded-2xl border border-gold-500/50 bg-charcoal-800 text-base font-semibold text-gold-200"
        >
          Open Job <ChevronRightIcon className="h-5 w-5" />
        </Link>
        {links.step && (
          <Link href={links.step} className="flex min-h-14 items-center justify-center rounded-2xl bg-charcoal-800 text-base font-semibold text-white">
            Current Step
          </Link>
        )}
      </div>
    </li>
  );
}
