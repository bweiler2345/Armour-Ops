"use client";

import { useState, useTransition, type FormEvent } from "react";
import Dialog from "@/components/Dialog";
import { fieldClass } from "@/components/fieldClass";
import {
  AlertIcon,
  KeyIcon,
  PlusIcon,
  SpinnerIcon,
  UsersIcon,
} from "@/components/Icons";
import { SectionHeading } from "@/components/PageHeading";
import TemporaryPasswordDialog from "@/components/TemporaryPasswordDialog";
import {
  createEmployee,
  resetEmployeePassword,
  setEmployeeActive,
} from "@/lib/actions/team";
import type { EmployeeFieldErrors } from "@/lib/auth/account-validation";
import { roleLabel } from "@/lib/auth/roles";
import type { TeamMember } from "@/lib/team/types";

type Reveal = {
  title: string;
  fullName: string;
  email: string;
  password: string;
  warning?: string;
};

type Confirm = {
  kind: "reset" | "deactivate" | "reactivate";
  member: TeamMember;
};

export default function TeamManager({
  members,
  canManage,
}: {
  members: TeamMember[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<EmployeeFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Holds a temporary password only while its dialog is open.
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const active = members.filter((member) => member.active);
  const inactive = members.filter((member) => !member.active);

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setFormError(null);
    setFieldErrors({});
    setNotice(null);

    startTransition(async () => {
      const result = await createEmployee(formData);
      if (result.status === "created") {
        form.reset();
        setFormOpen(false);
        setReveal({
          title: "Account created",
          fullName: result.fullName,
          email: result.email,
          password: result.temporaryPassword,
        });
      } else if (result.status === "invalid") {
        setFieldErrors(result.fieldErrors);
      } else {
        setFormError(result.message);
      }
    });
  }

  function runConfirm() {
    if (!confirm) return;
    const { kind, member } = confirm;
    setConfirmError(null);

    startTransition(async () => {
      if (kind === "reset") {
        const result = await resetEmployeePassword(member.id);
        if (result.status === "reset") {
          setConfirm(null);
          setReveal({
            title: "Password reset",
            fullName: result.fullName,
            email: result.email,
            password: result.temporaryPassword,
            warning: result.warning,
          });
        } else {
          setConfirmError(result.message);
        }
        return;
      }

      const result = await setEmployeeActive(member.id, kind === "reactivate");
      if (result.status === "ok") {
        setConfirm(null);
        setNotice(
          result.warning ??
            (kind === "deactivate"
              ? `${member.fullName || "The account"} was deactivated.`
              : `${member.fullName || "The account"} was reactivated.`),
        );
      } else {
        setConfirmError(result.message);
      }
    });
  }

  return (
    <>
      {notice && (
        <p
          role="status"
          className="mb-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-[15px] font-medium text-emerald-200"
        >
          {notice}
        </p>
      )}

      {formOpen ? (
        <section className="mb-8 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5">
          <h2 className="text-xl font-semibold text-white">New employee</h2>
          <p className="mt-1 text-[15px] text-charcoal-300">
            Armour Ops will create a temporary password for you to text them.
          </p>

          <form onSubmit={submitCreate} noValidate className="mt-5 flex flex-col gap-5">
            {formError && <ErrorBox message={formError} />}

            <TextField
              id="fullName"
              label="Full name"
              autoComplete="off"
              error={fieldErrors.fullName}
              disabled={pending}
            />
            <TextField
              id="email"
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="off"
              error={fieldErrors.email}
              disabled={pending}
            />

            <button
              type="submit"
              disabled={pending}
              className="gold-gradient flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:opacity-60"
            >
              {pending && <SpinnerIcon className="h-6 w-6" />}
              {pending ? "Creating…" : "Create Account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setFieldErrors({});
                setFormError(null);
              }}
              disabled={pending}
              className="flex min-h-14 w-full items-center justify-center rounded-2xl text-lg font-semibold text-charcoal-300 transition hover:text-white disabled:opacity-60"
            >
              Cancel
            </button>
          </form>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => {
            setFormOpen(true);
            setNotice(null);
          }}
          disabled={!canManage}
          className="gold-gradient mb-8 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="h-6 w-6" />
          Add Employee
        </button>
      )}

      <section aria-labelledby="active-accounts" className="mb-8">
        <SectionHeading id="active-accounts" title="Active" count={active.length} />
        {active.length === 0 ? (
          <EmptyState text="No active accounts." />
        ) : (
          <ul className="flex flex-col gap-4">
            {active.map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                canManage={canManage}
                onReset={() => setConfirm({ kind: "reset", member })}
                onDeactivate={() => setConfirm({ kind: "deactivate", member })}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="inactive-accounts">
        <SectionHeading id="inactive-accounts" title="Inactive" count={inactive.length} />
        {inactive.length === 0 ? (
          <EmptyState text="No deactivated accounts." />
        ) : (
          <ul className="flex flex-col gap-4">
            {inactive.map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                canManage={canManage}
                onReactivate={() => setConfirm({ kind: "reactivate", member })}
              />
            ))}
          </ul>
        )}
      </section>

      {confirm && (
        <ConfirmDialog
          confirm={confirm}
          pending={pending}
          error={confirmError}
          onConfirm={runConfirm}
          onCancel={() => {
            setConfirm(null);
            setConfirmError(null);
          }}
        />
      )}

      {reveal && (
        <TemporaryPasswordDialog
          title={reveal.title}
          fullName={reveal.fullName}
          email={reveal.email}
          password={reveal.password}
          warning={reveal.warning}
          onDone={() => setReveal(null)}
        />
      )}
    </>
  );
}

function MemberCard({
  member,
  canManage,
  onReset,
  onDeactivate,
  onReactivate,
}: {
  member: TeamMember;
  canManage: boolean;
  onReset?: () => void;
  onDeactivate?: () => void;
  onReactivate?: () => void;
}) {
  const status = !member.active
    ? { label: "Deactivated", style: "bg-red-500/10 text-red-200 ring-red-400/30" }
    : member.mustChangePassword
      ? {
          label: "Temporary password",
          style: "bg-gold-400/15 text-gold-300 ring-gold-400/40",
        }
      : { label: "Active", style: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30" };

  return (
    <li className="rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-charcoal-800 text-gold-400">
          <UsersIcon className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-white">
            <span className="break-words">{member.fullName || "Name not set"}</span>
            {member.isSelf && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-charcoal-300">
                You
              </span>
            )}
          </p>
          <p className="text-[15px] break-all text-charcoal-300">
            {member.email ?? "Email not available"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-charcoal-300 ring-1 ring-white/15">
              {roleLabel(member.role)}
            </span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${status.style}`}>
              {status.label}
            </span>
          </div>
        </div>
      </div>

      {member.isSelf ? (
        <p className="mt-4 text-sm text-charcoal-400">
          Change your own password from the Account screen.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={!canManage}
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-gold-500/50 bg-charcoal-800 text-base font-semibold text-gold-300 transition hover:bg-charcoal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <KeyIcon className="h-5 w-5" />
              Reset Password
            </button>
          )}
          {onDeactivate && (
            <button
              type="button"
              onClick={onDeactivate}
              disabled={!canManage}
              className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-700 bg-charcoal-800 text-base font-semibold text-red-300 transition hover:border-red-400/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Deactivate
            </button>
          )}
          {onReactivate && (
            <button
              type="button"
              onClick={onReactivate}
              disabled={!canManage}
              className="flex min-h-14 items-center justify-center rounded-2xl border border-emerald-400/40 bg-charcoal-800 text-base font-semibold text-emerald-300 transition hover:bg-charcoal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
            >
              Reactivate
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function ConfirmDialog({
  confirm,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  confirm: Confirm;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = confirm.member.fullName || "this person";
  const copy = {
    reset: {
      title: `Reset ${name}’s password?`,
      body: "Their current password stops working right away. You’ll get a new temporary password to text them. It will be shown only once.",
      action: "Reset Password",
      busy: "Resetting…",
      style: "gold-gradient text-charcoal-950",
    },
    deactivate: {
      title: `Deactivate ${name}?`,
      body: "They’ll be signed out and can’t use Armour Ops until you reactivate them. Their past work and history are kept.",
      action: "Deactivate",
      busy: "Deactivating…",
      style: "bg-red-500 text-white",
    },
    reactivate: {
      title: `Reactivate ${name}?`,
      body: "They can sign in again with their current password. If they’ve forgotten it, reset it afterwards.",
      action: "Reactivate",
      busy: "Reactivating…",
      style: "gold-gradient text-charcoal-950",
    },
  }[confirm.kind];

  return (
    <Dialog title={copy.title} onClose={onCancel} locked={pending}>
      <p className="text-[15px] leading-relaxed text-charcoal-300">{copy.body}</p>
      {error && (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      )}
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className={`mt-6 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-semibold shadow-lg shadow-black/30 transition active:scale-[0.98] disabled:opacity-60 ${copy.style}`}
      >
        {pending && <SpinnerIcon className="h-6 w-6" />}
        {pending ? copy.busy : copy.action}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="mt-3 flex min-h-14 w-full items-center justify-center rounded-2xl text-lg font-semibold text-charcoal-300 transition hover:text-white disabled:opacity-60"
      >
        Cancel
      </button>
    </Dialog>
  );
}

function TextField({
  id,
  label,
  type = "text",
  inputMode,
  autoComplete,
  error,
  disabled,
}: {
  id: string;
  label: string;
  type?: "text" | "email";
  inputMode?: "email";
  autoComplete: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[15px] font-semibold text-white">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoCapitalize={type === "email" ? "none" : "words"}
        autoCorrect="off"
        spellCheck={false}
        required
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={fieldClass(Boolean(error))}
      />
      {error && (
        <p id={`${id}-error`} className="mt-2 text-[15px] text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4"
    >
      <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
      <p className="text-[15px] leading-relaxed font-medium text-red-100">{message}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-charcoal-700 p-5 text-center text-[15px] text-charcoal-400">
      {text}
    </p>
  );
}
