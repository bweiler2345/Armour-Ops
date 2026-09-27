import Link from "next/link";
import { KeyIcon } from "@/components/Icons";

// Shown while the signed-in user still has an owner-issued temporary password.
export default function TemporaryPasswordReminder({ onAccountPage = false }) {
  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-2xl border border-gold-500/40 bg-gold-900/40 p-4"
    >
      <KeyIcon className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
      <div className="text-[15px] leading-relaxed text-charcoal-300">
        <p className="font-semibold text-white">You’re using a temporary password.</p>
        {onAccountPage ? (
          <p>Choose your own password below.</p>
        ) : (
          <Link
            href="/account#change-password"
            className="mt-1 inline-flex min-h-11 items-center font-semibold text-gold-300 underline underline-offset-4"
          >
            Change it on the Account screen
          </Link>
        )}
      </div>
    </div>
  );
}
