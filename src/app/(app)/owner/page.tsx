import type { Metadata } from "next";
import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { AlertIcon, CheckIcon, ChecklistIcon, ChevronRightIcon, JobsIcon, KeyIcon, UsersIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { listJobCards, type JobCardData } from "@/lib/jobs/queries";
import { ownerAttention } from "@/lib/jobs/sections";

export const metadata: Metadata = {
  title: "Owner Dashboard · Armour Ops",
};

// The owner's starting point. Jobs waiting for an installation or for Mark
// Job Complete are shown first with counts, and the page refreshes itself
// while open. Notifications are in-app only: employees also text the owner
// when a job is ready for an installation.
export default async function OwnerDashboardPage() {
  const user = await requireOwner();
  const firstName = user.fullName.trim().split(/\s+/)[0];
  const result = await listJobCards();
  const attention = result.status === "ok" ? ownerAttention(result.jobs) : null;

  return (
    <>
      <PageHeading
        eyebrow={firstName ? `Signed in as ${firstName}` : "Signed in"}
        title="Owner Dashboard"
        description="Only owner accounts can open this page."
      />

      <section aria-labelledby="needs-you" className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="needs-you" className="text-lg font-semibold text-white">
            Needs you
          </h2>
          {attention && (
            <span
              className={`min-w-8 rounded-full px-3 py-1 text-center text-sm font-bold tabular-nums ${
                attention.total > 0 ? "gold-gradient text-charcoal-950" : "bg-charcoal-800 text-charcoal-400"
              }`}
              aria-label={`${attention.total} job${attention.total === 1 ? "" : "s"} need you`}
            >
              {attention.total}
            </span>
          )}
        </div>
        {attention === null ? (
          <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            Jobs couldn’t be loaded. Refresh to try again.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <AttentionGroup
              title="Waiting for Base-Coat Installation"
              action="Mark Base Coat Installed"
              jobs={attention.waitingBase}
            />
            <AttentionGroup
              title="Waiting for Top-Coat Installation"
              action="Mark Top Coat Installed"
              jobs={attention.waitingTop}
            />
            <AttentionGroup title="Ready to Mark Complete" action="Review and Mark Job Complete" jobs={attention.readyToComplete} />
          </div>
        )}
      </section>

      <Link
        href="/owner/jobs"
        className="mb-6 flex min-h-20 items-center gap-4 rounded-3xl border border-gold-500/40 bg-charcoal-900 p-5 transition hover:border-gold-500/60 active:scale-[0.99]"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-charcoal-800 text-gold-400">
          <JobsIcon className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-white">Jobs</p>
          <p className="text-[15px] text-charcoal-300">
            Create jobs, edit Scheduled jobs, and make them available
          </p>
        </div>
        <ChevronRightIcon className="h-6 w-6 shrink-0 text-gold-300" />
      </Link>

      <Link
        href="/owner/team"
        className="mb-6 flex min-h-20 items-center gap-4 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5 transition hover:border-gold-500/40 active:scale-[0.99]"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-charcoal-800 text-gold-400">
          <UsersIcon className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-white">Team</p>
          <p className="text-[15px] text-charcoal-300">
            Create accounts, reset passwords, turn access on or off
          </p>
        </div>
        <ChevronRightIcon className="h-6 w-6 shrink-0 text-gold-300" />
      </Link>

      <Link
        href="/owner/workflow"
        className="mb-6 flex min-h-20 items-center gap-4 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5 transition hover:border-gold-500/40 active:scale-[0.99]"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-charcoal-800 text-gold-400">
          <ChecklistIcon className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-white">Workflow</p>
          <p className="text-[15px] text-charcoal-300">
            Review the approved job workflow (read only)
          </p>
        </div>
        <ChevronRightIcon className="h-6 w-6 shrink-0 text-gold-300" />
      </Link>

      <div className="flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-900/30 p-4">
        <ChecklistIcon className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
        <p className="text-[15px] leading-relaxed text-charcoal-300">
          <span className="font-semibold text-white">Coming soon.</span> Live
          job monitoring and Weekly Setup review will appear here in later phases.
        </p>
      </div>

      <AutoRefresh everyMs={30_000} />
    </>
  );
}

function AttentionGroup({ title, action, jobs }: { title: string; action: string; jobs: JobCardData[] }) {
  const waiting = jobs.length > 0;
  return (
    <div className={`rounded-3xl border p-4 ${waiting ? "border-gold-500/60 bg-gold-900/30" : "border-charcoal-800 bg-charcoal-900/60"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`flex items-center gap-2 text-[16px] font-semibold ${waiting ? "text-white" : "text-charcoal-400"}`}>
          {title.startsWith("Ready") ? <CheckIcon className="h-5 w-5 shrink-0 text-gold-300" /> : <KeyIcon className="h-5 w-5 shrink-0 text-gold-300" />}
          {title}
        </p>
        <span
          className={`min-w-8 rounded-full px-2.5 py-0.5 text-center text-sm font-bold tabular-nums ${
            waiting ? "gold-gradient text-charcoal-950" : "bg-charcoal-800 text-charcoal-400"
          }`}
        >
          {jobs.length}
        </span>
      </div>
      {waiting ? (
        <ul className="mt-3 flex flex-col gap-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/owner/jobs/${job.id}`}
                className="flex min-h-16 items-center gap-3 rounded-2xl border border-gold-500/40 bg-charcoal-900 px-4 py-3 active:scale-[0.99]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold text-white">
                    #{job.jobNumber} · {job.clientName}
                  </span>
                  <span className="block truncate text-sm text-charcoal-300">{job.address}</span>
                  <span className="block text-sm text-gold-300">
                    {action} · last activity {formatDateTime(job.lastActivityAt)}
                  </span>
                </span>
                <ChevronRightIcon className="h-6 w-6 shrink-0 text-gold-300" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-charcoal-400">None right now.</p>
      )}
    </div>
  );
}
