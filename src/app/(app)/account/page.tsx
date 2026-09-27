import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, SignOutIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import TemporaryPasswordReminder from "@/components/TemporaryPasswordReminder";
import { signOut } from "@/lib/auth/actions";
import { roleLabel } from "@/lib/auth/roles";
import { requireUser } from "@/lib/dal";
import ChangePasswordForm from "./ChangePasswordForm";

export const metadata: Metadata = {
  title: "Account · Armour Ops",
};

export default async function AccountPage() {
  const user = await requireUser();
  const name = user.fullName.trim() || "Name not set";
  const role = roleLabel(user.role);
  const initials =
    user.fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";

  return (
    <>
      <PageHeading title="Account" />
      {user.mustChangePassword && <TemporaryPasswordReminder onAccountPage />}

      <section className="rounded-3xl border border-charcoal-800 bg-charcoal-900 p-6">
        <div className="flex items-center gap-4">
          <div className="gold-gradient flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-2xl font-bold text-charcoal-950 shadow-lg shadow-black/40">
            {initials}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-semibold text-white">
              {name}
            </h2>
            <p className="mt-0.5 text-[15px] font-medium text-gold-300">
              {role}
            </p>
          </div>
        </div>

        <dl className="mt-6 divide-y divide-charcoal-800 rounded-2xl bg-charcoal-800/60">
          <Row label="Employee name" value={name} />
          <Row label="Role" value={role} />
        </dl>
      </section>

      {user.role === "owner" && (
        <Link
          href="/owner"
          className="mt-6 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border border-gold-500/50 bg-charcoal-800 text-lg font-semibold text-gold-300 transition hover:bg-charcoal-700 active:scale-[0.98]"
        >
          Owner Dashboard
          <ChevronRightIcon className="h-6 w-6" />
        </Link>
      )}

      <ChangePasswordForm />

      <form action={signOut}>
        <button
          type="submit"
          className="mt-6 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border border-charcoal-700 bg-charcoal-900 text-lg font-semibold text-white transition hover:border-red-400/50 hover:text-red-300 active:scale-[0.98]"
        >
          <SignOutIcon className="h-6 w-6" />
          Sign Out
        </button>
      </form>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 px-4">
      <dt className="text-[15px] text-charcoal-400">{label}</dt>
      <dd className="text-right text-[15px] font-semibold text-white">
        {value}
      </dd>
    </div>
  );
}
