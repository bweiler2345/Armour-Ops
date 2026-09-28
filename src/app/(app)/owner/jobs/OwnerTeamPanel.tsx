"use client";

import { useState, useTransition, type FormEvent } from "react";
import Dialog from "@/components/Dialog";
import { fieldClass } from "@/components/fieldClass";
import { AlertIcon, CheckIcon, PlusIcon, SpinnerIcon } from "@/components/Icons";
import { WorkingOwnerRows } from "@/components/JobTeam";
import { SectionHeading } from "@/components/PageHeading";
import {
  addTeamMember,
  changeLead,
  removeTeamMember,
  setJoinSetting,
  type TeamActionState,
} from "@/lib/actions/teams";
import type { EmployeeOption } from "@/lib/jobs/queries";
import { isActiveStatus, type JobStatus } from "@/lib/jobs/status";
import type { TeamMember, WorkingOwner } from "@/lib/jobs/team";

type Pending =
  | { kind: "remove"; member: TeamMember }
  | { kind: "make_lead"; member: TeamMember }
  | null;

export default function OwnerTeamPanel({
  jobId,
  status,
  allowEmployeesToJoin,
  team,
  employees,
  workingOwners = [],
  currentUserId,
}: {
  jobId: string;
  status: JobStatus;
  allowEmployeesToJoin: boolean;
  team: TeamMember[];
  employees: EmployeeOption[] | null;
  workingOwners?: WorkingOwner[];
  currentUserId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<TeamActionState>({});
  const [confirm, setConfirm] = useState<Pending>(null);
  const [newLead, setNewLead] = useState("");

  const complete = status === "complete";
  const inProgress = isActiveStatus(status);
  const canAdd = status === "available_to_claim" || inProgress;
  const onTeam = new Set(team.map((m) => m.employeeId));
  const addable = (employees ?? []).filter((e) => !onTeam.has(e.id));
  const hasLead = team.some((m) => m.role === "lead");

  function run(action: () => Promise<TeamActionState>, onDone?: () => void) {
    startTransition(async () => {
      const next = await action();
      setResult(next);
      if (next.status === "done") {
        setConfirm(null);
        setNewLead("");
        onDone?.();
      }
      setAdding(false);
    });
  }

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setResult({});
    setAdding(true);
    run(() => addTeamMember(jobId, {}, new FormData(form)), () => form.reset());
  }

  const removing = confirm?.kind === "remove" ? confirm.member : null;
  const others = removing ? team.filter((m) => m.employeeId !== removing.employeeId) : [];
  const needsNewLead = removing?.role === "lead" && others.length > 0;

  return (
    <section aria-labelledby="owner-team" className="mt-8">
      <SectionHeading id="owner-team" title="Team" count={team.length + workingOwners.length} />

      {result.error && (
        <div role="alert" className="mb-3 flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          <p className="text-[15px] leading-relaxed font-medium text-red-100">{result.error}</p>
        </div>
      )}
      {result.status === "done" && (
        <p role="status" className="mb-3 flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] font-medium text-emerald-200">
          <CheckIcon className="h-5 w-5" />
          {result.message}
        </p>
      )}

      {team.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-charcoal-700 p-5 text-center text-[15px] text-charcoal-400">
          {status === "scheduled"
            ? "No one can be added until the job is available."
            : inProgress
              ? "No team assigned. The first employee you add becomes the lead."
              : "No one is assigned to this job."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {team.map((member) => (
            <li key={member.employeeId} className="rounded-2xl border border-charcoal-800 bg-charcoal-900 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-[17px] font-semibold break-words text-white">
                  {member.name.trim() || "Unnamed employee"}
                  {!member.active && (
                    <span className="ml-2 text-sm font-normal text-red-300">Deactivated</span>
                  )}
                </span>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                    member.role === "lead"
                      ? "bg-gold-400/15 text-gold-300 ring-gold-400/40"
                      : "bg-white/5 text-charcoal-300 ring-white/15"
                  }`}
                >
                  {member.role === "lead" ? "Lead" : "Member"}
                </span>
              </div>
              {!complete && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {member.role === "member" && inProgress && member.active ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setResult({});
                        setConfirm({ kind: "make_lead", member });
                      }}
                      className="flex min-h-14 items-center justify-center rounded-2xl border border-gold-500/50 bg-charcoal-800 text-base font-semibold text-gold-300 transition active:scale-[0.98] disabled:opacity-50"
                    >
                      Make Lead
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setResult({});
                      setNewLead("");
                      setConfirm({ kind: "remove", member });
                    }}
                    className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-700 bg-charcoal-800 text-base font-semibold text-red-300 transition hover:border-red-400/50 active:scale-[0.98] disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <WorkingOwnerRows owners={workingOwners} currentUserId={currentUserId} />

      {canAdd && (
        <form onSubmit={submitAdd} className="mt-4 flex flex-col gap-3 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-4">
          <label htmlFor="employeeId" className="text-[15px] font-semibold text-white">
            {hasLead ? "Add an employee" : "Add an employee as lead"}
          </label>
          {employees === null ? (
            <p className="text-[15px] text-red-200">Employees couldn’t be loaded. Refresh to try again.</p>
          ) : addable.length === 0 ? (
            <p className="text-[15px] text-charcoal-400">Every active employee is already on this job.</p>
          ) : (
            <>
              <select
                id="employeeId"
                name="employeeId"
                defaultValue=""
                disabled={pending}
                className={`${fieldClass(false)} appearance-none`}
              >
                <option value="" disabled>
                  Choose an employee
                </option>
                {addable.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={pending}
                className="gold-gradient flex min-h-16 items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:opacity-60"
              >
                {adding ? <SpinnerIcon className="h-6 w-6" /> : <PlusIcon className="h-6 w-6" />}
                {adding ? "Adding…" : status === "available_to_claim" ? "Add as Lead" : "Add to Team"}
              </button>
              {status === "available_to_claim" && (
                <p className="text-sm text-charcoal-400">The job moves to Claimed with this employee as lead.</p>
              )}
            </>
          )}
        </form>
      )}

      {!complete && (
        <div className="mt-4 flex flex-col gap-3 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-4">
          <p className="text-[15px] text-white">
            <span className="font-semibold">Allow Employees to Join:</span>{" "}
            <span className={allowEmployeesToJoin ? "text-emerald-300" : "text-red-300"}>
              {allowEmployeesToJoin ? "On" : "Off"}
            </span>
          </p>
          <p className="text-sm text-charcoal-400">
            {allowEmployeesToJoin
              ? "Employees can join this job once it’s in progress."
              : "Only you can add employees to this job."}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setJoinSetting(jobId, !allowEmployeesToJoin))}
            className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-700 bg-charcoal-800 text-base font-semibold text-white transition hover:bg-charcoal-700 active:scale-[0.98] disabled:opacity-50"
          >
            {allowEmployeesToJoin ? "Turn Joining Off" : "Turn Joining On"}
          </button>
        </div>
      )}

      {confirm?.kind === "make_lead" && (
        <Dialog
          title={`Make ${confirm.member.name || "this employee"} the lead?`}
          onClose={() => setConfirm(null)}
          locked={pending}
        >
          <p className="text-[15px] leading-relaxed text-charcoal-300">
            The current lead stays on the team as a member. The change is recorded in the job’s history.
          </p>
          <ConfirmButtons
            label="Make Lead"
            busy="Changing…"
            pending={pending}
            error={result.error}
            onConfirm={() => run(() => changeLead(jobId, confirm.member.employeeId))}
            onCancel={() => setConfirm(null)}
          />
        </Dialog>
      )}

      {removing && (
        <Dialog
          title={`Remove ${removing.name || "this employee"}?`}
          onClose={() => setConfirm(null)}
          locked={pending}
        >
          <p className="text-[15px] leading-relaxed text-charcoal-300">
            They’ll leave the team. Their earlier work and history are kept.
          </p>
          {needsNewLead && (
            <div className="mt-4">
              <label htmlFor="newLead" className="mb-2 block text-[15px] font-semibold text-white">
                Choose the new lead
              </label>
              <select
                id="newLead"
                value={newLead}
                onChange={(e) => setNewLead(e.target.value)}
                disabled={pending}
                className={`${fieldClass(false)} appearance-none`}
              >
                <option value="" disabled>
                  Choose a team member
                </option>
                {others
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.employeeId} value={m.employeeId}>
                      {m.name || "Unnamed employee"}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {removing.role === "lead" && others.length === 0 && (
            <p className="mt-3 text-[15px] leading-relaxed text-gold-300">
              They’re the only one on this job. It will have no team until you add someone.
            </p>
          )}
          <ConfirmButtons
            label={needsNewLead ? "Remove and Set Lead" : "Remove"}
            busy="Removing…"
            pending={pending}
            disabled={needsNewLead && !newLead}
            danger
            error={result.error}
            onConfirm={() =>
              run(() => removeTeamMember(jobId, removing.employeeId, needsNewLead ? newLead : null))
            }
            onCancel={() => setConfirm(null)}
          />
        </Dialog>
      )}
    </section>
  );
}

function ConfirmButtons({
  label,
  busy,
  pending,
  disabled = false,
  danger = false,
  error,
  onConfirm,
  onCancel,
}: {
  label: string;
  busy: string;
  pending: boolean;
  disabled?: boolean;
  danger?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] font-medium text-red-100">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending || disabled}
        className={`mt-6 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:opacity-50 ${
          danger ? "bg-red-500 text-white" : "gold-gradient text-charcoal-950"
        }`}
      >
        {pending && <SpinnerIcon className="h-6 w-6" />}
        {pending ? busy : label}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="mt-3 flex min-h-14 w-full items-center justify-center rounded-2xl text-lg font-semibold text-charcoal-300 transition hover:text-white disabled:opacity-60"
      >
        Cancel
      </button>
    </>
  );
}
