import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertIcon } from "@/components/Icons";
import { homePathFor } from "@/lib/auth/roles";
import { safeNextPath } from "@/lib/auth/routes";
import { MESSAGES } from "@/lib/auth/sign-in";
import { getSession } from "@/lib/dal";
import { getSupabaseConfig } from "@/lib/supabase/config";
import SignInForm from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign In · Armour Ops",
};

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "");

  const session = await getSession();
  if (session.status === "active") {
    redirect(next || homePathFor(session.user.role));
  }

  const configured = getSupabaseConfig() !== null;
  const notice = !configured
    ? MESSAGES.notConfigured
    : params.error === "inactive"
      ? MESSAGES.inactive
      : null;

  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="gold-gradient flex h-16 w-16 items-center justify-center rounded-2xl text-3xl font-bold text-charcoal-950 shadow-xl shadow-black/50">
          A
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
          Armour <span className="gold-text">Ops</span>
        </h1>
        <p className="mt-1 text-xs font-medium tracking-[0.25em] text-charcoal-400 uppercase">
          Armour Floors
        </p>
      </div>

      <section className="rounded-3xl border border-charcoal-800 bg-charcoal-900 p-6 shadow-xl shadow-black/30">
        <h2 className="text-2xl font-semibold text-white">Sign in</h2>
        <p className="mt-1 text-[15px] text-charcoal-300">
          Use the email and password from the owner.
        </p>

        {notice && (
          <div
            role="status"
            className="mt-5 flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-900/30 p-4"
          >
            <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
            <p className="text-[15px] leading-relaxed text-charcoal-300">
              {notice}
            </p>
          </div>
        )}

        <SignInForm next={next} disabled={!configured} />
      </section>

      <p className="mt-6 text-center text-sm leading-relaxed text-charcoal-400">
        Accounts are created by the owner. Contact the owner if you need
        access or can’t sign in.
      </p>
    </main>
  );
}
