import type { Metadata } from "next";
import { AlertIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { TeamMember } from "@/lib/team/types";
import TeamManager from "./TeamManager";

export const metadata: Metadata = {
  title: "Team · Armour Ops",
};

export default async function TeamPage() {
  const owner = await requireOwner();
  const supabase = await createClient();

  // Read with the owner's own session: RLS allows owners to read every
  // profile. select("*") keeps the page working if the Phase 1B migration
  // has not been run yet (the new columns are then simply missing).
  const { data, error } = supabase
    ? await supabase.from("profiles").select("*").order("full_name")
    : { data: null, error: null };

  const members: TeamMember[] = (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email ?? null,
    role: row.role,
    active: row.active,
    mustChangePassword: row.must_change_password === true,
    deactivatedAt: row.deactivated_at ?? null,
    isSelf: row.id === owner.id,
  }));

  const adminReady = isAdminConfigured();
  const migrationReady = (data ?? []).every((row) => "must_change_password" in row);

  return (
    <>
      <PageHeading
        eyebrow="Owner"
        title="Team"
        description="Create employee accounts, reset forgotten passwords, and turn access on or off."
      />

      {(!adminReady || !migrationReady || error) && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-900/30 p-4"
        >
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
          <div className="text-[15px] leading-relaxed text-charcoal-300">
            <p className="font-semibold text-white">Team setup isn’t finished.</p>
            <ul className="mt-1 list-disc pl-5">
              {!migrationReady && (
                <li>Run the Phase 1B database update in the Supabase SQL Editor.</li>
              )}
              {!adminReady && (
                <li>
                  Add the Supabase secret key to <code>.env.local</code> as{" "}
                  <code>SUPABASE_SECRET_KEY</code> and restart the app.
                </li>
              )}
              {error && <li>The account list couldn’t be loaded. Refresh to try again.</li>}
            </ul>
            <p className="mt-1">Steps are in docs/SUPABASE_SETUP.md.</p>
          </div>
        </div>
      )}

      <TeamManager members={members} canManage={adminReady && migrationReady} />
    </>
  );
}
